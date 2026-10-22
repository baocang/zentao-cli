import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModuleAction } from '../types/index.js';
import { ZentaoError } from '../errors.js';

/** Use the SDK callback so version checks, cancellation and auth stay upstream. */
export const downloadAttachment: NonNullable<ModuleAction['request']> = async ({ request, client, timeout, insecure }) => {
    const response = await client.request(request.path, {
        method: 'GET',
        query: { fileID: request.id },
        responseType: 'response', timeout, insecure,
    }) as Response;
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const encoded = disposition.match(/filename\*\s*=\s*(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
    const plain = disposition.match(/filename\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\n]+))/i);
    let name = (encoded?.[1] ?? plain?.[1] ?? plain?.[2] ?? plain?.[3] ?? `file_${request.id}`).trim();
    if (encoded) {
        try { name = decodeURIComponent(name); }
        catch { /* Preserve malformed percent-encoding as a literal filename. */ }
    }
    name = name.split(/[\\/]/).at(-1) ?? '';
    if (!name || name === '.' || name === '..') name = `file_${request.id}`;
    const directory = typeof request.params.output === 'string' ? request.params.output : '.';
    const output = join(directory, name);
    const content = Buffer.from(await response.arrayBuffer());
    try {
        await writeFile(output, content, { flag: 'wx' });
    } catch (error) {
        const reason = (error as NodeJS.ErrnoException).code === 'EEXIST'
            ? `目标文件已存在: ${output}` : `无法写入目标文件: ${output}`;
        throw new ZentaoError('E2009', { option: 'output', reason }, error);
    }
    return { status: 'success', data: { file: output, size: content.byteLength } };
};
