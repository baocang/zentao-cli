import type { FileWarning } from 'zentao-api';
import type { ZentaoClient } from '../api/index.js';
import { mapSdkError } from '../errors.js';
import { basename, extname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { ModuleDefinition, Profile, ModuleActionName, UserConfig } from '../types/index.js';
import { getAction, getModule, getObjectProps } from '../modules/helper.js';
import { downloadFile } from './file-download.js';
import { executeModuleCommand } from '../modules/executor.js';
import { buildParams } from '../modules/args.js';
import type { ModuleExecutionResult } from '../modules/executor.js';
import { getProfileConfig } from '../config/store.js';
import { formatJson, formatOutput } from '../utils/format.js';
import type { ModuleActionOptions } from '../types/index.js';
import { createInterface } from 'node:readline/promises';
import { renderObject } from '../utils/render.js';
import { fileRecoveryDetails, formatError, ZentaoError } from '../errors.js';
import { commandSignal } from '../utils/lifecycle.js';
import { batchTargets, targetId } from '../modules/targets.js';
import { actionObjectTypeFor } from '../modules/extensions.js';


async function confirmDelete(format: string, count: number, machineReadable = false): Promise<boolean> {
    if (machineReadable || format === 'json' || format === 'raw' || !process.stdin.isTTY || !process.stderr.isTTY) {
        throw new ZentaoError('E2009', {
            option: 'yes',
            reason: '非交互或机器可读模式下删除必须显式传入 --yes',
        });
    }

    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
        const answer = await rl.question(`确认删除 ${count} 个对象？(y/n): `, { signal: commandSignal() });
        return answer.toLowerCase() === 'y';
    } finally {
        rl.close();
    }
}

function reportFileWarnings(warnings: FileWarning[], objectID?: number): void {
    for (const warning of warnings) {
        const label = objectID === undefined ? '附件警告' : `对象 ${objectID} 附件警告`;
        console.error(`${label}：${JSON.stringify(warning)}`);
    }
}

function resultMeta(execution: ModuleExecutionResult): Record<string, unknown> | undefined {
    const { meta, fileWarnings, resultObjectType } = execution;
    if (!resultObjectType && !fileWarnings?.length) return meta;
    return { ...meta, ...(resultObjectType && { resultObjectType }), ...(fileWarnings?.length && { fileWarnings }) };
}

export function renderModuleExecution(
    execution: ModuleExecutionResult,
    options: ModuleActionOptions,
    config: UserConfig,
): void {
    const format = options.format ?? config.defaultOutputFormat ?? 'markdown';
    if (format !== 'json' && execution.fileWarnings?.length) reportFileWarnings(execution.fileWarnings);

    if (execution.action.path === '/files/{fileID}/read' && format !== 'json') {
        if (format === 'raw') {
            const content = execution.rawResponse;
            process.stdout.write(content instanceof ArrayBuffer ? Buffer.from(content) : String(content));
        } else {
            console.log(execution.data);
        }
        return;
    }

    if (format === 'raw' || format === 'json') {
        const output = formatOutput(execution.data, {
            format,
            isList: execution.isList,
            fields: execution.fields,
            pager: execution.pager,
            meta: resultMeta(execution),
            jsonPretty: config.jsonPretty,
            rawResponse: execution.rawResponse,
        });
        if (output) console.log(output);
        return;
    }

    if (execution.action.type === 'list') {
        const output = formatOutput(execution.data, {
            format,
            isList: true,
            fields: execution.fields,
            pager: execution.pager,
            meta: execution.meta,
            jsonPretty: config.jsonPretty,
        });
        if (output) console.log(output);
        return;
    }

    if (execution.action.type === 'get') {
        const output = renderObject(execution.data as Record<string, unknown>, format, { fields: execution.fields });
        if (output) console.log(output);
        return;
    }

    const output = formatOutput(execution.data, {
        format,
        isList: false,
        fields: execution.fields,
        jsonPretty: config.jsonPretty,
    });
    if (output) {
        console.log(output);
    } else if (format === 'markdown' || format === 'table') {
        const raw = execution.rawResponse as { message?: unknown } | undefined;
        const serverMessage = raw?.message;
        console.log(typeof serverMessage === 'string' && serverMessage.trim() ? serverMessage : '操作成功');
    }
}

/**
 * Download an attachment into a local directory, naming the file from the
 * server's Content-Disposition header.
 *
 * Byte transfer is delegated to the shared streaming downloader
 * (file-download.ts): streamed to a temporary file and atomically renamed.
 * This wrapper adds the directory semantics, header-based filename
 * resolution, no-overwrite protection and CLI output.
 */
export async function downloadFileAttachment(
    client: ZentaoClient,
    fileID: string,
    output: string | undefined,
    format: string,
): Promise<void> {
    const dir = output ?? '.';
    mkdirSync(dir, { recursive: true });
    const readAction = getModule('file')!.actions.find(item => item.name === 'read')!;
    const result = await downloadFile(client, readAction, fileID, join(dir, `file_${fileID}`), {
        resolvePath: headers => {
            const cd = headers.get('Content-Disposition') ?? '';
            const encodedMatch = cd.match(/filename\*\s*=\s*(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
            const plainMatch = cd.match(/filename\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\n]+))/i);
            const rawFilename = encodedMatch?.[1] ?? plainMatch?.[1] ?? plainMatch?.[2] ?? plainMatch?.[3];
            let filename = rawFilename?.trim() || `file_${fileID}`;
            if (encodedMatch) {
                try {
                    filename = decodeURIComponent(filename);
                } catch {
                    // Keep the undecoded server filename when percent encoding is malformed.
                }
            }
            const destination = join(dir, basename(filename));
            if (existsSync(destination)) {
                throw new ZentaoError('E2009', { option: 'output', reason: `目标文件已存在: ${destination}` });
            }
            return destination;
        },
    });

    if (format === 'json' || format === 'raw') {
        console.log(JSON.stringify({ ok: true, data: { file: result.path, size: result.bytes } }));
    } else {
        console.log(`已下载: ${result.path} (${result.bytes} bytes)`);
    }
}

const INLINE_IMAGE_MIME: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
};

/**
 * Upload images for a comment and embed them inline in the comment body.
 *
 * The upload attaches the file to the target object; the comment body then
 * references the returned file-read URL, which the ZenTao web UI renders
 * inline. Both calls share the caller's token: the server's uid session-album
 * re-attachment (easysoft/zentao-cli#25) re-attaches the freshly uploaded
 * files to this comment's object, which is exactly where they belong.
 */
export async function embedCommentImages(
    client: ZentaoClient,
    mod: ModuleDefinition,
    params: Record<string, unknown>,
    images: string[],
): Promise<Record<string, unknown>> {
    const objectType = actionObjectTypeFor(mod.name);
    const commentAction = mod.actions.find(action => action.name === 'comment');
    const idKey = commentAction ? targetId(commentAction) : undefined;
    if (!objectType || !idKey) throw new ZentaoError('E2005', { module: mod.name });
    const objectID = params[idKey] ?? params.id;
    if (objectID === undefined) throw new ZentaoError('E2003', { param: idKey });

    const data = { ...(params.data as Record<string, unknown>) };
    const text = typeof data.comment === 'string' ? data.comment : '';
    const marks: string[] = [];
    for (const imagePath of images) {
        if (!existsSync(imagePath)) {
            throw new ZentaoError('E2009', { option: 'image', reason: `图片文件不存在: ${imagePath}` });
        }
        const ext = extname(imagePath).toLowerCase();
        const mime = INLINE_IMAGE_MIME[ext];
        if (!mime) {
            throw new ZentaoError('E2009', { option: 'image', reason: `不支持的图片格式 ${ext || '(无扩展名)'}，支持 ${Object.keys(INLINE_IMAGE_MIME).join(' ')}` });
        }
        const form = new FormData();
        form.append('file', new Blob([readFileSync(imagePath)], { type: mime }), basename(imagePath));
        form.append('objectType', objectType);
        form.append('objectID', String(objectID));
        let result: { status?: string; id?: number; url?: string };
        try {
            result = await client.request('/files', { method: 'POST', body: form }) as typeof result;
        } catch (error) {
            throw mapSdkError(error);
        }
        if (!result || typeof result !== 'object' || result.id === undefined || (result.status && result.status !== 'success')) {
            throw new ZentaoError('E2008', {
                url: '/files',
                status: '',
                serverResponse: JSON.stringify(result).slice(0, 300),
            });
        }
        const url = result.url ?? `/file-read-${result.id}${ext}`;
        marks.push(`<img src="${url}" alt="${basename(imagePath)}" />`);
    }
    data.comment = text ? `${text}\n${marks.join('\n')}` : marks.join('\n');
    return { ...params, data };
}

type BatchId = number;

interface BatchError {
    objectID: BatchId;
    recoveryMessage?: string;
    error: {
        code?: string;
        message: string;
        details?: unknown;
    };
}

interface BatchResult {
    ids: BatchId[];
    success: BatchId[];
    failed: BatchId[];
    skipped: BatchId[];
    data: Map<BatchId, { value: unknown; meta?: Record<string, unknown> }>;
    errors: BatchError[];
}

function toBatchError(id: BatchId, error: unknown): BatchError {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return {
        objectID: id,
        ...(normalized instanceof ZentaoError && fileRecoveryDetails(normalized.details)
            ? { recoveryMessage: formatError(normalized, 'table') } : {}),
        error: {
            ...(normalized instanceof ZentaoError ? { code: normalized.code, details: normalized.details } : {}),
            message: normalized.message,
        },
    };
}

function renderBatchResult(result: BatchResult, format: string, pretty: boolean, includeData: boolean): string {
    if (format === 'json' || format === 'raw') {
        return formatJson({
            ok: result.failed.length === 0,
            data: result.ids.map(objectID => {
                const item = result.data.get(objectID);
                if (item) {
                    return { objectID, ok: true, data: item.value ?? null, ...(item.meta && { meta: item.meta }) };
                }
                return result.skipped.includes(objectID) ? { objectID, ok: false, skipped: true }
                    : { objectID, ok: false, error: result.errors.find(item => item.objectID === objectID)!.error };
            }),
            meta: { success: result.success.length, failed: result.failed.length, skipped: result.skipped.length },
        }, pretty);
    }

    const lines: string[] = [];
    if (includeData && result.data.size) {
        const rows = Array.from(result.data, ([objectID, { value }]) => (
            value && typeof value === 'object' && !Array.isArray(value)
                ? { ...(value as Record<string, unknown>), objectID }
                : { objectID, value }
        ));
        const dataOutput = formatOutput(rows, { format: 'markdown', isList: true });
        if (dataOutput) lines.push(dataOutput);
    }
    lines.push(
        `操作成功：${result.success.length > 0 ? result.success.join(', ') : '无'}`,
        `操作失败：${result.failed.length > 0 ? result.failed.join(', ') : '无'}`,
    );
    if (result.skipped.length > 0) {
        lines.push(`已跳过：${result.skipped.join(', ')}`);
    }
    for (const item of result.errors) {
        const code = item.error.code ? `E${item.error.code}: ` : '';
        lines.push(`${item.objectID}: ${item.recoveryMessage ?? code + item.error.message}`);
    }
    return lines.join('\n');
}

/** 输出模块对应对象的属性定义（与 `zentao <module> props` 对应） */
export function showModuleProps(mod: ModuleDefinition, options: ModuleActionOptions): void {

    const props = getObjectProps(mod.name);
    const format = options.format ?? 'markdown';
    const output = formatOutput(props, { format, isList: false });
    if (output) console.log(output);
}


/**
 * 执行模块级 CRUD 或扩展操作：负责拼路径、分页拉取、客户端过滤/排序、HTML 转 Markdown 及格式化输出。
 */
export async function handleModuleCommand(
    client: ZentaoClient,
    module: ModuleDefinition,
    actionName: ModuleActionName,
    args: string[],
    profile: Profile,
    options: ModuleActionOptions,
    preparedParams?: Record<string, unknown>,
): Promise<void> {
    const config = getProfileConfig(profile);
    const batchFailFast = options.batchFailFast ?? config.batchFailFast ?? false;
    const format = options.format ?? config.defaultOutputFormat ?? 'markdown';

    const action = getAction(module, actionName);
    if (!action) {
        throw new ZentaoError('E2005', { module: module.name });
    }

    // Resolve all argument sources before selecting targets or confirming deletion.
    const params = preparedParams ?? buildParams(options, actionName, args);
    const batchIds = batchTargets(action, params, options.ids);
    if (batchIds) {
        if (format === 'raw') throw new ZentaoError('E2009', { option: 'raw/ids', reason: '原始响应不支持批量组合，请使用 json' });
        if (action.type === 'delete' && !options.yes) {
            if (!await confirmDelete(format, batchIds.length, options.machineReadable || options.input === false)) {
                return;
            }
        }

        const result: BatchResult = {
            ids: batchIds,
            success: [],
            failed: [],
            skipped: [],
            data: new Map(),
            errors: [],
        };
        for (let index = 0; index < batchIds.length; index++) {
            commandSignal()?.throwIfAborted();
            const rawId = batchIds[index];
            const id = Number(rawId);
            try {
                const execution = await executeModuleCommand(
                    client,
                    module,
                    actionName,
                    [],
                    options,
                    config,
                    { ...params, id: rawId },
                );
                result.success.push(id);
                result.data.set(id, { value: action.type === 'delete' ? null : execution.data, meta: resultMeta(execution) });
                if (format !== 'json' && execution.fileWarnings?.length) reportFileWarnings(execution.fileWarnings, id);
            } catch (error) {
                if (commandSignal()?.aborted && error instanceof ZentaoError && fileRecoveryDetails(error.details)) throw error;
                commandSignal()?.throwIfAborted();
                result.failed.push(id);
                result.errors.push(toBatchError(id, error));
                if (batchFailFast) {
                    result.skipped.push(...batchIds.slice(index + 1).map(Number));
                    break;
                }
            }
        }

        console.log(renderBatchResult(result, format, config.jsonPretty ?? false, action.type !== 'delete'));
        if (result.failed.length > 0) {
            process.exitCode = 1;
        }
        return;
    }

    if (action.type === 'delete' && !options.yes) {
        if (!await confirmDelete(format, 1, options.machineReadable || options.input === false)) {
            return;
        }
    }

    const execution = await executeModuleCommand(client, module, actionName, [], options, config, params);
    renderModuleExecution(execution, options, config);
}
