import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ZentaoClient } from '../src/api/index.js';
import { createClient } from '../src/api/index.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import { assertAuthenticatedPayload, isLoginPageHtml } from '../src/auth/response.js';
import { downloadFileAttachment, handleModuleCommand, renderModuleExecution } from '../src/commands/module-handler.js';
import { mockProfile } from './helpers.js';
import { getModule } from '../src/modules/index.js';
import { applyRegistryExtensions } from '../src/modules/extensions.js';
import { createMcpServer } from '../src/mcp/server.js';
import { toolData } from './mcp-helpers.js';

// The registry is process-global; apply extensions before any getModule() read.
applyRegistryExtensions();

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="zh-cn">
<body><form id="loginForm"><input name="account"><input name="password"></form></body>
</html>`;

describe('ZenTao authentication response detection', () => {
    test('recognizes an HTTP 200 ZenTao login page', () => {
        expect(isLoginPageHtml(LOGIN_PAGE)).toBe(true);
        expect(() => assertAuthenticatedPayload(LOGIN_PAGE)).toThrow(expect.objectContaining({ code: '1004' }));
    });

    test('does not reject ordinary HTML returned as business data', () => {
        const html = '<p>Bug description</p>';
        expect(isLoginPageHtml(html)).toBe(false);
        expect(() => assertAuthenticatedPayload(html)).not.toThrow();
    });

    test('does not reject a generic full HTML document without login controls', () => {
        const html = '<!DOCTYPE html><html><body><article>API documentation</article></body></html>';
        expect(isLoginPageHtml(html)).toBe(false);
        expect(() => assertAuthenticatedPayload(html)).not.toThrow();
    });

    test('requires both a ZenTao login marker and account input', () => {
        const unrelatedForm = '<!DOCTYPE html><html><form><input name="account"></form></html>';
        const incompleteLogin = '<!DOCTYPE html><html><form id="loginForm"></form></html>';
        expect(isLoginPageHtml(unrelatedForm)).toBe(false);
        expect(isLoginPageHtml(incompleteLogin)).toBe(false);
    });
});

describe('file download', () => {
    function mockDownloadClient(disposition: string, body: string) {
        return {
            getZentaoConfig: async () => ({ version: '23.0' }),
            async request() {
                return new Response(body, {
                    headers: { 'Content-Disposition': disposition, 'Content-Type': 'application/octet-stream' },
                });
            },
        } as unknown as ZentaoClient;
    }

    test('downloads with the server filename from Content-Disposition', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-download-'));
        try {
            const logs: string[] = [];
            const originalLog = console.log;
            console.log = (value?: unknown) => logs.push(String(value));
            try {
                await downloadFileAttachment(mockDownloadClient(`attachment; filename="report 42.txt"`, 'payload'), '7', dir, 'markdown');
            } finally {
                console.log = originalLog;
            }
            const path = join(dir, 'report 42.txt');
            expect(readFileSync(path, 'utf8')).toBe('payload');
            expect(logs.join('\n')).toContain('已下载');
            expect(logs.join('\n')).toContain('7 bytes');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('decodes RFC 5987 encoded filenames', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-download-'));
        try {
            await downloadFileAttachment(
                mockDownloadClient(`attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.png`, 'png-bytes'),
                '8', dir, 'json',
            );
            expect(existsSync(join(dir, '报告.png'))).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('refuses to overwrite an existing file', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-download-'));
        try {
            writeFileSync(join(dir, 'exists.txt'), 'old');
            await expect(downloadFileAttachment(
                mockDownloadClient('attachment; filename="exists.txt"', 'new'), '9', dir, 'markdown',
            )).rejects.toThrow('已存在');
            expect(readFileSync(join(dir, 'exists.txt'), 'utf8')).toBe('old');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('empty action response rendering', () => {
    const action = () => getModule('bug')!.actions.find(action => action.name === 'comment')!;

    function render(data: unknown, rawResponse: unknown, format = 'markdown'): string[] {
        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (value?: unknown) => logs.push(String(value));
        try {
            renderModuleExecution(
                { action: action(), data, rawResponse, fields: undefined, isList: false },
                { format } as never,
                { defaultOutputFormat: 'markdown' } as never,
            );
        } finally {
            console.log = originalLog;
        }
        return logs;
    }

    test('prints the server message when data is empty', () => {
        const logs = render(undefined, { status: 'success', message: '保存成功' });
        expect(logs.join('\n')).toContain('保存成功');
    });

    test('prints 操作成功 when data is empty and the server sent nothing readable', () => {
        const logs = render(undefined, { status: 'success' });
        expect(logs.join('\n')).toContain('操作成功');
    });

    test('json format stays explicit with data null', () => {
        const logs = render(undefined, { status: 'success' }, 'json');
        expect(logs.join('\n')).toContain('"data":null');
        expect(logs.join('\n')).not.toContain('操作成功');
    });
});

describe('HTTP MCP upload root allowlist', () => {
    function fakeAuth(url: string) {
        return {
            async getContext() {
                return {
                    client: createClient(url, 'test-token'),
                    config: DEFAULT_CONFIG,
                    identity: { server: url },
                };
            },
        };
    }

    test('multipart actions become available with a root and stay blocked outside it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-mcp-upload-root-'));
        const outside = mkdtempSync(join(tmpdir(), 'zentao-mcp-upload-outside-'));
        const inside = join(dir, 'fixture.txt');
        writeFileSync(inside, 'upload-root-fixture');
        let uploads = 0;
        const upstream = Bun.serve({
            hostname: '127.0.0.1', port: 0,
            fetch(request) {
                if (!request.url.includes('/api.php')) return Response.json({ version: '22.5' });
                uploads++;
                return Response.json({ status: 'success', id: uploads, url: `/file-read-${uploads}.txt` });
            },
        });
        try {
            const server = createMcpServer(fakeAuth(upstream.url.toString()), {
                modules: ['file'],
                allowLocalFiles: false,
                localUploadRoot: dir,
            });
            const client = new Client({ name: 'upload-root-test', version: '0.0.0' });
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            try {
                await server.connect(serverTransport);
                await client.connect(clientTransport);

                const help = toolData(await client.callTool({ name: 'zentao_action_help', arguments: { module: 'file', action: 'create' } }));
                expect(help.available).toBe(true);
                expect(help.unavailableReason).toBeUndefined();

                const ok = await client.callTool({ name: 'zentao_file', arguments: { action: 'create', params: { file: inside, objectType: 'story', objectID: 1 } } });
                expect(ok.isError).toBeUndefined();
                expect(uploads).toBe(1);

                const outsideFile = join(outside, 'secret.txt');
                writeFileSync(outsideFile, 'secret');
                const denied = await client.callTool({ name: 'zentao_file', arguments: { action: 'create', params: { file: outsideFile, objectType: 'story', objectID: 1 } } });
                expect(denied.isError).toBe(true);
                expect(JSON.stringify(denied)).toContain('超出允许的根目录');
                expect(uploads).toBe(1);
            } finally {
                await client.close();
                await server.close();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync(outside, { recursive: true, force: true });
            void upstream.stop(true);
        }
    });
});
