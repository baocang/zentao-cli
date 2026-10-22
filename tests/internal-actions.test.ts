import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineModuleActions } from 'zentao-api';
import { createClient } from '../src/api/index.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import { executeModuleCommand } from '../src/modules/executor.js';
import { getModule } from '../src/modules/helper.js';
import { registerInternalActions } from '../src/modules/internal-actions.js';
import { toolData } from './mcp-helpers.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';

async function execute(module: string, action: string, params: Record<string, unknown>, fetcher: (req: Request) => Response | Promise<Response>) {
    const server = Bun.serve({
        hostname: '127.0.0.1', port: 0,
        fetch(req) {
            if (new URL(req.url).searchParams.get('mode') === 'getconfig') return Response.json({ version: '22.4' });
            return fetcher(req);
        },
    });
    try {
        return await executeModuleCommand(createClient(server.url.toString(), 'fixture-token'), getModule(module)!, action, [], {}, DEFAULT_CONFIG, params);
    } finally { server.stop(true); }
}

test('future upstream operations take precedence over internal additions', () => {
    const officialConfirm = getModule('bug')!.actions.find(action => action.name === 'confirm')!;
    const internalEffort = getModule('task')!.actions.find(action => action.name === 'effort')!;
    const futureOfficial = { ...internalEffort, path: '/official/tasks/{taskID}/efforts', minVersion: ['22.5'] };
    try {
        defineModuleActions('task', futureOfficial);
        registerInternalActions();
        expect(getModule('task')!.actions.find(action => action.name === 'effort')).toEqual(futureOfficial);
        expect(getModule('bug')!.actions.find(action => action.name === 'confirm')).toEqual(officialConfirm);
        expect(getModule('file')!.actions.some(action => action.name === 'upload')).toBe(false);
        expect(getModule('file')!.actions.find(action => action.name === 'create')?.requestBody?.mediaType).toBe('multipart/form-data');
    } finally { defineModuleActions('task', internalEffort); }
});

test('history reads and comments preserve routes, bodies and permission failures', async () => {
    const history = await execute('bug', 'history', { id: 42 }, req => {
        expect(new URL(req.url).pathname).toBe('/api.php/v2/actions/bug/42');
        return Response.json({ actions: [{ id: 7, action: 'commented', comment: 'verified' }] });
    });
    expect(history.data).toEqual([{ id: 7, action: 'commented', comment: 'verified' }]);
    await execute('story', 'comment', { id: 43, comment: 'line 1\nline 2' }, async req => {
        expect(req.method).toBe('POST');
        expect(new URL(req.url).pathname).toBe('/api.php/v2/actions/story/43');
        expect(await req.json()).toEqual({ comment: 'line 1\nline 2' });
        return Response.json({ status: 'success' });
    });
    await expect(execute('bug', 'history', { id: 42 }, () => new Response('Access not allowed', { status: 403 })))
        .rejects.toMatchObject({ code: '2006' });
});

test('task effort reads the legacy query ID and object-map response', async () => {
    const result = await execute('task', 'effort', { id: 17 }, req => {
        const url = new URL(req.url);
        expect(url.pathname).toBe('/api.php/v2/tasks/17/recordworkhour');
        expect(url.searchParams.get('taskID')).toBe('17');
        return Response.json({ efforts: { '9': { id: 9, consumed: 2, work: 'fixture' } } });
    });
    expect(result.data).toEqual([{ id: 9, consumed: 2, work: 'fixture' }]);
});

test('task work-hour writes retain array bodies and effort record IDs', async () => {
    await execute('task', 'recordestimate', {
        id: 17, data: { date: ['2026-10-22'], work: ['fixture work'], consumed: [2], left: [3] },
    }, async req => {
        expect(req.method).toBe('PUT');
        expect(new URL(req.url).pathname).toBe('/api.php/v2/tasks/17/recordworkhour');
        expect(await req.json()).toEqual({ date: ['2026-10-22'], work: ['fixture work'], consumed: [2], left: [3] });
        return Response.json({ status: 'success' });
    });
    await execute('task', 'editeffort', { id: 9, consumed: 3, left: 2 }, async req => {
        const url = new URL(req.url);
        expect(req.method).toBe('PUT');
        expect(url.pathname).toBe('/api.php/v2/tasks/9/editeffort');
        expect(url.searchParams.get('effortID')).toBe('9');
        expect(await req.json()).toMatchObject({ consumed: 3, left: 2 });
        return Response.json({ status: 'success' });
    });
    await execute('task', 'deleteeffort', { id: 9 }, req => {
        const url = new URL(req.url);
        expect(req.method).toBe('DELETE');
        expect(url.pathname).toBe('/api.php/v2/tasks/9/deleteworkhour');
        expect(url.searchParams.get('effortID')).toBe('9');
        return Response.json({ status: 'success' });
    });
});

test('attachment download keeps binary bytes and never overwrites an existing file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zentao-internal-download-'));
    const content = new Uint8Array([0, 255, 13, 10, 128]);
    const fetcher = (req: Request) => {
        const url = new URL(req.url);
        expect(url.pathname).toBe('/api.php/v2/files/12/download');
        expect(url.searchParams.get('fileID')).toBe('12');
        expect(url.searchParams.has('output')).toBe(false);
        return new Response(content, { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''..%2F%E9%99%84%E4%BB%B6.bin" } });
    };
    try {
        const result = await execute('file', 'download', { id: 12, output: directory }, fetcher);
        expect(result.data).toEqual({ file: join(directory, '附件.bin'), size: 5 });
        expect(readFileSync(join(directory, '附件.bin'))).toEqual(Buffer.from(content));
        await expect(execute('file', 'download', { id: 12, output: directory }, fetcher)).rejects.toMatchObject({ code: '2009' });
        expect(readFileSync(join(directory, '附件.bin'))).toEqual(Buffer.from(content));
        await expect(execute('file', 'download', { id: 13, output: directory }, () => new Response('Forbidden', { status: 403 })))
            .rejects.toMatchObject({ code: '2006' });
        expect(readdirSync(directory)).toEqual(['附件.bin']);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('remote MCP refuses local download writes before authentication', async () => {
    let authentications = 0;
    const server = createMcpServer({
        async getContext() {
            authentications++;
            throw new Error('Authentication must not be reached');
        },
    }, { modules: ['file'], allowLocalFiles: false });
    const client = new Client({ name: 'download-policy-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const help = toolData(await client.callTool({ name: 'zentao_action_help', arguments: { module: 'file', action: 'download' } }));
        expect(help.available).toBe(false);
        expect(help.unavailableReason).toContain('下载附件');
        const result = await client.callTool({ name: 'zentao_file', arguments: { action: 'download', id: 12 } });
        expect(result.isError).toBe(true);
        expect(authentications).toBe(0);
    } finally { await client.close(); await server.close(); }
});
