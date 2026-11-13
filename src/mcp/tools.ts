import { brandText } from '../brand.js';
import { findRemoteUser } from '../auth/user.js';
import { actionContract, actionIsReadOnly } from '../modules/contract.js';
import { z } from 'zod';
import { request } from 'zentao-api';
import { getModuleActionParams } from '../modules/helper.js';
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getAction, getAllModules, getModule } from '../modules/helper.js';
import type { ModuleDefinition, ModuleAction, ModuleActionOptions } from '../types/index.js';
import { executeModuleCommand } from '../modules/executor.js';
import { ZentaoError } from '../errors.js';
import type { AuthProvider } from './server.js';
import { withRequestSignal } from '../api/index.js';
import { validateAssistant } from '../api/assistant.js';
import { getScopeAliasTarget, normalizeToolParams } from './params.js';
import { listOutputSchema, outputSchema, toolError, toolResult } from './results.js';
import { supportsBatch, targetId } from '../modules/targets.js';

export interface McpToolOptions {
    /** Startup default; individual tool calls may override or disable it. */
    assistant?: string;
    readOnly?: boolean;
    modules?: string[];
    splitTools?: boolean;
    /** Local transports may upload paths; remote callers must never read host files. */
    allowLocalFiles?: boolean;
    /**
     * Opt-in allowlist root for remote multipart uploads (HTTP MCP). When set,
     * file paths are accepted only inside this directory after resolution.
     */
    localUploadRoot?: string;
}

const LOCAL_FILE_UPLOAD_UNAVAILABLE = 'HTTP MCP 不支持通过本地路径上传服务端文件，请使用本地 CLI 或 stdio MCP';

function isReadAction(action: ModuleAction): boolean { return actionIsReadOnly(action); }

function isActionAvailable(action: ModuleAction, options: McpToolOptions): boolean {
    if (options.readOnly && !isReadAction(action)) return false;
    if (action.requestBody?.mediaType !== 'multipart/form-data') return true;
    // Multipart uploads need local file access: allowed on local transports,
    // or remotely only when an explicit upload root allowlist is configured.
    return options.allowLocalFiles !== false || options.localUploadRoot !== undefined;
}

/** Restrict remote upload paths to the configured root after resolving symlinks. */
function ensureUploadPathWithinRoot(filePath: string, root: string): void {
    let resolved: string;
    let resolvedRoot: string;
    try {
        resolved = realpathSync(filePath);
        resolvedRoot = realpathSync(root);
    } catch {
        throw new ZentaoError('E2009', { option: 'file', reason: '文件或根目录不存在' });
    }
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep)) {
        throw new ZentaoError('E2009', { option: 'file', reason: '上传路径超出允许的根目录 ZENTAO_MCP_UPLOAD_ROOT' });
    }
}

function buildToolDescription(mod: ModuleDefinition): string {
    return brandText`${mod.display ?? mod.name}操作；参数、示例和最低版本见 zentao_action_help`;
}

function buildActionEnum(mod: ModuleDefinition): [string, ...string[]] {
    const names = mod.actions.map(a => a.name);
    return [names[0], ...names.slice(1)];
}

function buildInputSchema(mod: ModuleDefinition) {
    const actionEnum = buildActionEnum(mod);
    const parameters = mod.actions.flatMap(action => getModuleActionParams(mod.name, action.name));
    const names = new Set(parameters.map(param => param.name));
    const shape: Record<string, z.ZodType> = {
        assistant: z.string().optional().describe('本次操作来源标记；省略继承服务设置，空字符串关闭'),
        action: z.enum(actionEnum).describe(mod.actions.map(action => `${action.name}: ${action.display ?? action.name}`).join('; ')),
        params: z.record(z.string(), z.unknown()).optional().describe(brandText('路径、查询或请求体参数；必填项见 zentao_action_help')),
    };
    if (parameters.some(param => param.role === 'path' && param.name.endsWith('ID') && param.name !== 'scopeID')) {
        shape.id = z.number().int().nonnegative().optional().describe('首个路径 ID 简写；多 ID 用 params');
    }
    for (const name of ['product', 'project', 'execution']) {
        if (mod.actions.some(action => getScopeAliasTarget(mod, action, name))) {
            shape[name] = z.number().int().nonnegative().optional().describe(`${name}ID 或 scope/scopeID 简写，冲突时报错`);
        }
    }
    if (mod.actions.some(action => action.type === 'list' || action.type === 'get')) {
        shape.pick = z.string().optional().describe('返回字段，逗号分隔');
    }
    if (mod.actions.some(action => action.type === 'list')) {
        shape.all = z.boolean().optional().describe('显式遍历全部页面后本地处理');
        shape.maxItems = z.number().int().positive().optional().describe('整次调用最多返回条数');
        shape.filter = z.array(z.string()).optional().describe('当前页过滤，组内逗号为 AND、多组为 OR；远端筛选见 params.filters');
        shape.sort = z.string().optional().describe('当前页排序，如 pri:asc');
        shape.search = z.array(z.string()).optional().describe('当前页搜索，组内逗号为 AND、多组为 OR');
        shape.searchFields = z.string().optional().describe('搜索字段，逗号分隔');
    }
    if (mod.actions.some(action => supportsBatch(action))) {
        shape.ids = z.array(z.number().int().positive()).optional().describe('批量目标 ID；get/update/delete/action 类操作逐个执行并返回逐项结果');
        shape.batchFailFast = z.boolean().optional().describe('批量失败后跳过剩余目标');
    }
    if (names.has('pageID')) shape.page = z.number().int().positive().optional().describe('页码，从 1 开始');
    if (names.has('recPerPage')) shape.recPerPage = z.number().int().min(1).max(1000).optional().describe('每页 1–1000 条');
    return z.object(shape).strict();
}

/** Examples use typed placeholders, not real object IDs or ready-to-submit business data. */
function actionExample(mod: ModuleDefinition, action: ModuleAction, splitTools?: boolean) {
    const bodyExample = action.requestBody?.schema.example as Record<string, unknown> | undefined;
    const params = Object.fromEntries(getModuleActionParams(mod.name, action.name)
        .filter(param => param.required && param.defaultValue === undefined)
        .map(param => [param.name, (param.role === 'body' ? bodyExample?.[param.name] : undefined) ?? (param.type === 'array' ? [] : param.options?.[0]?.value
            ?? (param.type === 'number' || (param.role === 'path' && param.name.endsWith('ID')) ? 1
                : param.type === 'boolean' ? false : param.type === 'object' ? {} : `<${param.name}>`))]));
    return {
        name: brandText`zentao_${mod.name}${splitTools ? isReadAction(action) ? '_read' : '_write' : ''}`,
        arguments: { action: action.name, ...(Object.keys(params).length ? { params } : {}) },
        note: 'ID、文本等均为格式示例，请替换为实际值后调用。',
    };
}

interface ToolInput {
    assistant?: string;
    action: string;
    id?: number;
    product?: number;
    project?: number;
    execution?: number;
    params?: Record<string, unknown>;
    pick?: string;
    filter?: string[];
    sort?: string;
    search?: string[];
    searchFields?: string;
    page?: number;
    recPerPage?: number;
    all?: boolean;
    maxItems?: number;
    ids?: number[];
    batchFailFast?: boolean;
}

async function handleProfileTool(auth: AuthProvider, signal?: AbortSignal, assistant?: string): Promise<CallToolResult> {
    if (assistant !== undefined) validateAssistant(assistant);
    const { client, identity: profile } = await auth.getContext(signal);
    if (profile.account === undefined) {
        return toolResult({
            server: profile.server,
            account: null,
            user: null,
            userFound: false,
            note: brandText('无法仅凭禅道 Token 确定账号，未查询用户详情。'),
        });
    }
    const scopedClient = withRequestSignal(client, signal);
    const { user } = await findRemoteUser(scopedClient, profile.account, assistant);
    const identity = {
        account: profile.account,
        server: profile.server,
        userFound: Boolean(user),
        user: user ? Object.fromEntries(['id', 'account', 'realname', 'dept', 'role']
            .filter(key => user![key] !== undefined).map(key => [key, user![key]])) : null,
    };

    return toolResult(identity);
}

interface SwitchProfileInput {
    profileKey: string;
}

async function handleSwitchProfileTool(input: SwitchProfileInput, auth: AuthProvider): Promise<CallToolResult> {
    const { identity: current } = await auth.switchProfile!(input.profileKey);
    const currentKey = `${current.account}@${current.server}`;
    return toolResult({ status: 'success', currentProfile: currentKey });
}

async function handleModuleTool(
    mod: ModuleDefinition,
    input: ToolInput,
    auth: AuthProvider,
    options: McpToolOptions,
    signal?: AbortSignal,
): Promise<CallToolResult> {
    const assistant = input.assistant ?? options.assistant;
    if (assistant !== undefined) validateAssistant(assistant);
    const action = getAction(mod, input.action);
    if (!action) throw new ZentaoError('E2005', { module: mod.name });
    if (!isActionAvailable(action, options)) {
        throw new ZentaoError('E2009', { option: `${mod.name}/${action.name}`, reason: LOCAL_FILE_UPLOAD_UNAVAILABLE });
    }
    for (const option of ['filter', 'sort', 'search', 'searchFields', 'pick'] as const) {
        if (input[option] !== undefined && action.type !== 'list' && !(option === 'pick' && action.type === 'get')) {
            throw new ZentaoError('E2009', { option, reason: `不适用于 ${mod.name}/${action.name}` });
        }
    }
    if ((input.all !== undefined || input.maxItems !== undefined) && action.type !== 'list') {
        throw new ZentaoError('E2009', { option: 'all/maxItems', reason: `不适用于 ${mod.name}/${action.name}` });
    }
    if (input.ids !== undefined) {
        if (!supportsBatch(action)) throw new ZentaoError('E2009', { option: 'ids', reason: `此操作不支持批量对象操作` });
        if (!input.ids.length) throw new ZentaoError('E2009', { option: 'ids', reason: '至少需要一个目标 ID' });
    }
    const params = normalizeToolParams(mod, action, input);
    if (action.requestBody?.mediaType === 'multipart/form-data' && options.allowLocalFiles === false && options.localUploadRoot !== undefined) {
        const flat = params.file;
        const nested = (params.data as Record<string, unknown> | undefined)?.file;
        const filePath = typeof flat === 'string' ? flat : typeof nested === 'string' ? nested : undefined;
        if (!filePath) {
            throw new ZentaoError('E2009', { option: 'file', reason: '需要本地文件路径' });
        }
        ensureUploadPathWithinRoot(filePath, options.localUploadRoot);
    }
    const { client, config } = await auth.getContext(signal);
    const actionName = input.action;

    const opts: ModuleActionOptions = {
        assistant,
        pick: input.pick,
        filter: input.filter,
        sort: input.sort,
        search: input.search,
        searchFields: input.searchFields,
        recPerPage: input.recPerPage != null ? String(input.recPerPage) : undefined,
        all: input.all,
        maxItems: input.maxItems != null ? String(input.maxItems) : undefined,
        batchFailFast: input.batchFailFast,
        format: 'json',
    };

    if (input.ids?.length) {
        const key = targetId(action)!;
        const scopedClient = withRequestSignal(client, signal);
        const data: Array<Record<string, unknown>> = [];
        let failed = 0;
        let skipped = 0;
        const errors: Array<{ objectID: number; error: { code?: string; message: string } }> = [];
        for (let index = 0; index < input.ids.length; index++) {
            const id = input.ids[index];
            signal?.throwIfAborted();
            try {
                const execution = await executeModuleCommand(scopedClient, mod, actionName, [], opts, config, { ...params, [key]: id });
                data.push({ objectID: id, ok: true, data: execution.data ?? execution.rawResponse ?? null });
            } catch (error) {
                signal?.throwIfAborted();
                failed++;
                const normalized = error instanceof ZentaoError ? error : new Error(String(error));
                errors.push({
                    objectID: id,
                    error: {
                        ...(normalized instanceof ZentaoError ? { code: `E${normalized.code}` } : {}),
                        message: normalized.message,
                    },
                });
                data.push({ objectID: id, ok: false, error: { message: normalized.message } });
                if (input.batchFailFast) {
                    skipped = input.ids.length - index - 1;
                    break;
                }
            }
        }
        return toolResult({
            ok: failed === 0,
            data,
            meta: { success: input.ids.length - failed - skipped, failed, skipped, ...(errors.length ? { errors } : {}) },
        });
    }

    const execution = await executeModuleCommand(withRequestSignal(client, signal), mod, actionName, [], opts, config, params);

    if (execution.action.type === 'list') {
        return toolResult(execution.data, {
            ...(execution.pager ? { pager: execution.pager } : {}),
            meta: {
                processingScope: 'page',
                returnedCount: Array.isArray(execution.data) ? execution.data.length : 0,
                ...(execution.pager ? { totalScope: 'serverBeforeLocalProcessing' } : {}),
            },
        });
    }

    if (execution.action.type === 'get') {
        return toolResult(execution.data);
    }

    // create / update / delete / action
    return toolResult(execution.data ?? execution.rawResponse);
}

function toolAnnotations(actions: readonly ModuleAction[]) {
    const readOnly = actions.every(isReadAction);
    const destructive = actions.some(action => ['update', 'delete', 'action'].includes(action.type));
    return {
        readOnlyHint: readOnly,
        destructiveHint: destructive,
        openWorldHint: true,
    };
}

export function registerModuleTools(server: McpServer, auth: AuthProvider, options: McpToolOptions = {}): void {
    const selectedModules = options.modules ? [...new Set(options.modules)].map(name => {
        const mod = getModule(name);
        if (!mod) throw new ZentaoError('E2001', { module: name });
        return mod;
    }) : getAllModules();
    if (!selectedModules.length) throw new ZentaoError('E2009', { option: 'modules', reason: '至少指定一个模块' });

    server.registerTool(
        brandText('zentao_action_help'),
        {
            description: brandText('查看禅道操作的路径、参数定义和最低版本要求，无需登录；调用业务工具前可按需查询'),
            inputSchema: z.object({ module: z.string().describe('模块名，如 doc、story'), action: z.string().describe('操作名，如 createMyDoc、getGrades') }).strict(),
            outputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        },
        async ({ module, action }) => {
            try {
                const mod = getModule(module);
                if (!mod) throw new ZentaoError('E2001', { module });
                const definition = getAction(mod, action);
                if (!definition) throw new ZentaoError('E2005', { module: mod.name });
                return toolResult({
                    ...actionContract(mod, definition),
                    available: selectedModules.some(selected => selected.name === mod.name) && isActionAvailable(definition, options),
                    ...(options.allowLocalFiles === false && options.localUploadRoot === undefined && definition.requestBody?.mediaType === 'multipart/form-data'
                        ? { unavailableReason: LOCAL_FILE_UPLOAD_UNAVAILABLE } : {}),
                    example: actionExample(mod, definition, options.splitTools),
                });
            } catch (error) {
                return toolError(error, { module, action });
            }
        },
    );

    server.registerTool(
        brandText('zentao_profile'),
        {
            description: '获取当前 MCP 绑定的账号和站点；已知账号时查询远端用户详情，仅 Token 认证时账号未知。userFound=false 表示无用户详情，服务端失败会报错',
            inputSchema: z.object({ assistant: z.string().optional().describe('本次操作来源标记；省略继承服务设置，空字符串关闭') }).strict(),
            outputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
        },
        async (input, extra) => {
            try {
                return await handleProfileTool(auth, extra.signal, input.assistant ?? options.assistant);
            } catch (error) {
                return toolError(error, { module: 'user', action: 'list' });
            }
        },
    );

    if (auth.switchProfile && !options.readOnly) server.registerTool(
        brandText('zentao_switch_profile'),
        {
            description: '切换当前 MCP 实例的登录账号，不改变 CLI 或其他 MCP 实例的账号',
            inputSchema: z.object({ profileKey: z.string().describe('目标用户配置标识，支持 account@server、account 或 account@hostname') }).strict(),
            outputSchema,
            annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        },
        async (input) => {
            try {
                return await handleSwitchProfileTool(input as SwitchProfileInput, auth);
            } catch (error) {
                return toolError(error);
            }
        },
    );

    for (const source of new Set(selectedModules)) {
        const actions = source.actions.filter(action => isActionAvailable(action, options));
        const groups = options.splitTools
            ? [{ suffix: '_read', actions: actions.filter(isReadAction) }, { suffix: '_write', actions: actions.filter(action => !isReadAction(action)) }]
            : [{ suffix: '', actions }];
        for (const group of groups) {
            if (!group.actions.length) continue;
            const mod = { ...source, actions: group.actions };
            const name = brandText`zentao_${mod.name}${group.suffix}`;
            const description = buildToolDescription(mod);
            const inputSchema = buildInputSchema(mod);
            const annotations = toolAnnotations(mod.actions);

            server.registerTool(name, { description, inputSchema, outputSchema: mod.actions.some(action => action.type === 'list') ? listOutputSchema : outputSchema, annotations }, async (raw, extra) => {
                const input = raw as unknown as ToolInput;
                try {
                    // Keep full module metadata for autoFill, but enforce this tool's subset.
                    if (!group.actions.some(action => action.name === input.action)) throw new ZentaoError('E2006');
                    return await handleModuleTool(source, input as ToolInput, auth, options, extra.signal);
                } catch (error) {
                    return toolError(error, { module: mod.name, action: input.action });
                }
            });
        }
    }
}
