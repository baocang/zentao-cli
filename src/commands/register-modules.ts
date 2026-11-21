import { isDeepStrictEqual } from 'node:util';
import { ZentaoError } from '../errors.js';
import { brandText } from '../brand.js';
import { Command, Option } from 'commander';
import { getModuleNames, getModule } from '../modules/index.js';
import { getScopeAliasTarget } from '../mcp/params.js';
import { actionContract, kebabCase, paginationFields } from '../modules/contract.js';
import { parseCliValue, prepareCliParams } from '../modules/cli-input.js';
import { ensureAuth, resolveAuthSource, tryReauth } from '../auth/flow.js';
import { fileIdAtSite, supportsFileUrl } from '../modules/file-url.js';
import { getProfileConfig } from '../config/store.js';
import { downloadFile } from './file-download.js';
import { downloadFileAttachment, embedCommentImages, handleModuleCommand, showModuleProps } from './module-handler.js';
import type { ModuleActionOptions } from '../types/index.js';
import { normalizeIdLike } from '../modules/targets.js';
import { emitResult } from '../utils/output.js';
import { applyOptionsJson } from '../utils/cli-options.js';

/** Commander 的 `collect` 回调：将多次出现的选项累积为数组 */
function collect(value: string, previous: string[] = []): string[] {
    return previous.concat([value]);
}

/** SDK actions are real commands; unknown options are rejected by Commander. */
export function registerModuleCommands(program: Command): void {
    for (const name of getModuleNames()) {
        const mod = getModule(name)!;
        const resource = program.command(name).description(mod.display ?? name);
        // Bare numeric positional dispatches to `get` — the shorthand agents
        // keep typing (`zentao bug 24314`) even after upstream removed it.
        resource.argument('[target]', brandText`对象 ID 简写，等价于 zentao ${name} get <target>`);
        resource.action(async (target: string | undefined, _opts: unknown, command: Command) => {
            if (target === undefined) {
                resource.outputHelp();
                return;
            }
            const normalized = normalizeIdLike(target.trim());
            if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(Number(normalized)) || Number(normalized) < 1) {
                throw new ZentaoError('E2009', {
                    option: 'target',
                    reason: brandText`无法识别 "${target}"；查看对象请使用 zentao ${name} get <id>，全部操作见 zentao ${name} --help`,
                });
            }
            const getAction = mod.actions.find(action => action.name === 'get');
            if (!getAction) {
                throw new ZentaoError('E2009', { option: 'target', reason: brandText`模块 ${name} 没有 get 操作，请查看 zentao ${name} --help` });
            }
            const options = command.optsWithGlobals() as ModuleActionOptions;
            const params = await prepareCliParams(mod, getAction, normalized, options, {});
            const { client, profile } = await ensureAuth(options);
            await handleModuleCommand(client, mod, 'get', [], profile, options, params);
        });
        resource.command('props').description('返回对象字段定义（离线）').action((_options, command: Command) => {
            showModuleProps(mod, command.optsWithGlobals());
        });
        if (name === 'file') {
            // Non-registry subcommand: binary download bypasses the JSON pipeline.
            resource.command('download')
                .description('下载附件到本地文件（原始字节流，支持 Content-Disposition 命名）')
                .argument('<fileID>', '附件 ID')
                .option('--output <dir>', '输出目录，默认当前目录')
                .action(async (...args: unknown[]) => {
                    const command = args.at(-1) as Command;
                    const parsed = command.optsWithGlobals() as ModuleActionOptions;
                    const fileID = args[0] as string;
                    if (!/^\d+$/.test(fileID)) {
                        throw new ZentaoError('E2009', { option: 'fileID', reason: '需要有效数字' });
                    }
                    const { client, profile } = await ensureAuth(parsed);
                    try {
                        await downloadFileAttachment(
                            client,
                            fileID,
                            typeof parsed.output === 'string' ? parsed.output : undefined,
                            parsed.format ?? 'markdown',
                        );
                    } catch (error) {
                        if (error instanceof ZentaoError && error.code === '1004') {
                            const reauthed = await tryReauth(profile, parsed);
                            if (reauthed) {
                                await downloadFileAttachment(
                                    reauthed.client,
                                    fileID,
                                    typeof parsed.output === 'string' ? parsed.output : undefined,
                                    parsed.format ?? 'markdown',
                                );
                                return;
                            }
                        }
                        throw error;
                    }
                });
        }
        for (const action of mod.actions) {
            const contract = actionContract(mod, action);
            const fileRead = name === 'file' && action.name === 'read';
            const acceptsFileUrl = supportsFileUrl(name, action.name);
            const cmd = resource.command(kebabCase(action.name))
                .description(`${action.display ?? action.name}（最低版本：${action.minVersion.join(' / ')}）`);
            if (contract.target) cmd.argument('[target]', acceptsFileUrl
                ? '单个附件标识或当前站点的附件 URL，--file-id 可单独指定标识'
                : `单个 ${contract.target}；也可使用命名参数`);
            const mappings: Array<{ name: string; attribute: string }> = [];
            const pagination = paginationFields(mod, action);
            const reserved = new Set(pagination ? [pagination.page.name, pagination.size.name] : []);
            for (const param of contract.parameters) {
                if (reserved.has(param.name) || mappings.some(item => item.name === param.name)) continue;
                const flag = param.flag.slice(2);
                const option = new Option(`--${flag} ${param.type === 'boolean' ? '[boolean]' : '<value>'}`,
                    `${param.description ?? param.name}${param.required && !(acceptsFileUrl && param.name === 'fileID') ? '（必填）' : ''}`);
                if (param.type === 'array') option.argParser((value: string, previous: string[] = []) => previous.concat(value));
                if (param.type === 'boolean') option.preset(true);
                cmd.addOption(option);
                mappings.push({ name: param.name, attribute: option.attributeName() });
                if (param.type === 'boolean') cmd.addOption(new Option(`--no-${flag}`, `将 ${param.name} 设为 false`).default(undefined));
                if (param.type !== 'array') {
                    let previous: unknown;
                    const checkDuplicate = () => {
                        const value = parseCliValue(cmd.getOptionValue(option.attributeName()), param);
                        if (previous !== undefined && !isDeepStrictEqual(previous, value)) {
                            throw new ZentaoError('E2009', { option: flag, reason: '重复选项的输入值冲突' });
                        }
                        previous = value;
                    };
                    cmd.on(`option:${option.name()}`, checkDuplicate);
                    if (param.type === 'boolean') cmd.on(`option:no-${flag}`, checkDuplicate);
                }
            }
            for (const scope of ['product', 'project', 'execution']) {
                if (!getScopeAliasTarget(mod, action, scope) || mappings.some(item => item.name === scope)) continue;
                const option = new Option(`--${scope} <id>`, `${scope}ID 或 scope/scopeID 别名`);
                cmd.addOption(option);
                mappings.push({ name: scope, attribute: option.attributeName() });
            }
            if (action.requestBody) cmd.option('--data <json|@file|@->', 'JSON 对象、文件或显式标准输入');
            cmd.option('--options <json>', 'CLI 调用选项（JSON 对象；显式命令行参数优先）');
            if (contract.markdownFields.length) {
                const fields = contract.markdownFields.join(', ');
                const condition = name === 'doc' ? '（content 需显式指定 --content-type html）' : '';
                cmd.option('--markdown [fields]', `将 Markdown 转为 HTML。可选 ${fields}${condition}，多个字段用逗号分隔，省略时转换本次提供的全部 HTML 字段`);
            }
            if (fileRead) cmd.option('--output <path>', '流式保存附件，下载完成后替换目标文件');
            if (contract.batch) cmd.option('--ids <ids>', '批量目标 ID，逗号分隔并去重').option('--batch-fail-fast', '失败后跳过剩余目标');
            if (action.name === 'comment') cmd.option('--image <path>', '随备注上传并内嵌到正文的图片路径（可多次）', collect);
            if (action.type === 'delete') cmd.option('--yes', '确认删除');
            if (action.type === 'list' || (action.type === 'get' && !fileRead)) cmd.option('--fields <fields>', '返回字段，逗号分隔').option('--html-to-markdown', '显式将富文本字段转换为 Markdown');
            if (action.type === 'list') {
                cmd.option('--max-items <number>', '整次命令最多返回条数');
                cmd.option('--filter <expr>', '当前获取范围内过滤；组内 AND，多次指定为 OR', collect);
                cmd.option('--search <keywords>', '当前获取范围内搜索', collect);
                cmd.option('--search-fields <fields>', '本地搜索字段');
                cmd.option('--sort <expr>', '当前获取范围内排序，如 id:asc');
            }
            if (pagination) cmd.option('--page <number>', '指定页，从 1 开始')
                .option('--page-size <number>', '每次服务端请求的页大小').option('--all', '显式遍历全部页面');
            cmd.action(async (...args: unknown[]) => {
                const command = args.at(-1) as Command;
                const parsed = command.optsWithGlobals();
                const options: ModuleActionOptions = applyOptionsJson({ ...parsed, pick: parsed.fields, recPerPage: parsed.pageSize });
                const values = Object.fromEntries(mappings.map(item => [item.name, parsed[item.attribute]]));
                let source: ReturnType<typeof resolveAuthSource> | undefined;
                const params = await prepareCliParams(mod, action, contract.target ? args[0] as string | undefined : undefined, options, values, url => {
                    source = resolveAuthSource(options.profile);
                    fileIdAtSite(url, source.server);
                });
                const { client, profile } = await ensureAuth(options, source);
                if (fileRead && options.output !== undefined) {
                    const format = options.format ?? getProfileConfig(profile).defaultOutputFormat;
                    if (format === 'raw') throw new ZentaoError('E2009', { option: 'output', reason: '写入文件时请使用 table、markdown 或 json 输出下载结果' });
                    const download = async (activeClient: typeof client): Promise<void> => {
                        const result = await downloadFile(activeClient, action, String(params.fileID), options.output!, options);
                        emitResult(result, { format });
                    };
                    try {
                        await download(client);
                    } catch (error) {
                        // Expired profile token: re-login once with matching environment credentials.
                        if (error instanceof ZentaoError && error.code === '1004') {
                            const reauthed = await tryReauth(profile, options);
                            if (reauthed) {
                                await download(reauthed.client);
                                return;
                            }
                        }
                        throw error;
                    }
                    return;
                }
                const images = parsed.image as string[] | undefined;
                const run = async (activeClient: typeof client, activeProfile: typeof profile): Promise<void> => {
                    const effectiveParams = images?.length
                        ? await embedCommentImages(activeClient, mod, params, images)
                        : params;
                    await handleModuleCommand(activeClient, mod, action.name, [], activeProfile, options, effectiveParams);
                };
                try {
                    await run(client, profile);
                } catch (error) {
                    // Expired profile token: re-login once with matching environment credentials.
                    if (error instanceof ZentaoError && error.code === '1004') {
                        const reauthed = await tryReauth(profile, options);
                        if (reauthed) {
                            await run(reauthed.client, reauthed.profile);
                            return;
                        }
                    }
                    throw error;
                }
            });
        }
    }
}
