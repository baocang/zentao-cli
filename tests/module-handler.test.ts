import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type ZentaoClient } from '../src/api/index';
import { handleModuleCommand, uploadFileAttachment } from '../src/commands/module-handler';
import { getModule } from '../src/modules';
import { applyZentaoCompatibilityOverrides } from '../src/modules/overrides';
import type { ModuleActionName, ModuleActionOptions } from '../src/types';
import { mockProfile } from './helpers';

async function captureConsoleLog(fn: () => Promise<void>): Promise<string[]> {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(' '));
    };
    try {
        await fn();
    } finally {
        console.log = originalLog;
    }
    return output;
}

describe('handleModuleCommand batch ids', () => {
    async function runDelete(args: string[], options: ModuleActionOptions = {}) {
        const requests: Array<{ method: string; path: string }> = [];
        const client = {
            request: async (path: string, opts: { method?: string }) => {
                requests.push({ method: (opts.method ?? 'GET').toLowerCase(), path });
                return { status: 'success' };
            },
        } as unknown as ZentaoClient;

        await handleModuleCommand(
            client,
            getModule('product')!,
            'delete' as ModuleActionName,
            args,
            mockProfile,
            { yes: true, silent: true, ...options },
        );

        return requests;
    }

    test('executes comma-separated positional ids as batch delete', async () => {
        const requests = await runDelete(['1,2']);

        expect(requests).toEqual([
            { method: 'delete', path: '/products/1' },
            { method: 'delete', path: '/products/2' },
        ]);
    });

    test('executes comma-separated --id option as batch delete', async () => {
        const requests = await runDelete([], { id: '1,2' });

        expect(requests).toEqual([
            { method: 'delete', path: '/products/1' },
            { method: 'delete', path: '/products/2' },
        ]);
    });
});

describe('file attachment upload', () => {
    test('sends exact file bytes and object binding as multipart form data', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-cli-upload-'));
        const filePath = join(dir, 'sample.bin');
        const content = Uint8Array.from([0, 1, 127, 128, 255]);
        writeFileSync(filePath, content);
        let sentBody: FormData | undefined;
        const client = {
            request: async (_path: string, options: { body?: FormData }) => {
                sentBody = options.body;
                return { status: 'success', id: 123 };
            },
        } as unknown as ZentaoClient;

        try {
            const result = await uploadFileAttachment(client, mockProfile, filePath, 'bug', '123');
            expect(result.fileName).toBe('sample.bin');
            expect(sentBody?.get('objectType')).toBe('bug');
            expect(sentBody?.get('objectID')).toBe('123');
            const file = sentBody?.get('file');
            expect(file).toBeInstanceOf(File);
            expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(content);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('requires objectType and objectID together', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-cli-upload-'));
        const filePath = join(dir, 'sample.txt');
        writeFileSync(filePath, 'test');
        const client = { request: async () => ({ status: 'success' }) } as unknown as ZentaoClient;

        try {
            await expect(uploadFileAttachment(client, mockProfile, filePath, 'bug'))
                .rejects.toMatchObject({ code: '2009' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('rejects an HTTP 200 business failure response', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-cli-upload-'));
        const filePath = join(dir, 'sample.txt');
        writeFileSync(filePath, 'test');
        const client = {
            request: async () => ({ status: 'fail', message: 'not allowed' }),
        } as unknown as ZentaoClient;

        try {
            await expect(uploadFileAttachment(client, mockProfile, filePath))
                .rejects.toMatchObject({ code: '2008' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('restricts MCP uploads to the allowed root', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-cli-upload-'));
        const allowedRoot = join(dir, 'workspace');
        mkdirSync(allowedRoot);
        const outsideFile = join(dir, 'outside.txt');
        writeFileSync(outsideFile, 'private');
        const client = { request: async () => ({ status: 'success' }) } as unknown as ZentaoClient;

        try {
            await expect(uploadFileAttachment(client, mockProfile, outsideFile, undefined, undefined, allowedRoot))
                .rejects.toMatchObject({ code: '2009' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('rejects files larger than 50 MiB before reading them', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-cli-upload-'));
        const filePath = join(dir, 'large.bin');
        writeFileSync(filePath, '');
        truncateSync(filePath, 50 * 1024 * 1024 + 1);
        const client = { request: async () => ({ status: 'success' }) } as unknown as ZentaoClient;

        try {
            await expect(uploadFileAttachment(client, mockProfile, filePath))
                .rejects.toMatchObject({ code: '2009' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('file attachment download', () => {
    test('does not write an HTTP 200 login page as an attachment', async () => {
        applyZentaoCompatibilityOverrides();
        const dir = mkdtempSync(join(tmpdir(), 'zentao-cli-download-'));
        const server = Bun.serve({
            port: 0,
            fetch: () => new Response(
                '<!DOCTYPE html><html><body><form id="loginForm"><input name="account"></form></body></html>',
                { headers: { 'Content-Type': 'text/html' } },
            ),
        });
        const profile = { ...mockProfile, server: server.url.toString().replace(/\/$/, '') };

        try {
            await expect(handleModuleCommand(
                createClient(server.url.toString(), 'expired-token'),
                getModule('file')!,
                'download' as ModuleActionName,
                ['123'],
                profile,
                { output: dir },
            )).rejects.toMatchObject({ code: '1004' });
            expect(readdirSync(dir)).toEqual([]);
        } finally {
            server.stop(true);
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('does not overwrite an existing file with the server filename', async () => {
        applyZentaoCompatibilityOverrides();
        const dir = mkdtempSync(join(tmpdir(), 'zentao-cli-download-'));
        const outputPath = join(dir, 'existing.txt');
        writeFileSync(outputPath, 'keep');
        const server = Bun.serve({
            port: 0,
            fetch: () => new Response('replacement', {
                headers: { 'Content-Disposition': 'attachment; filename="existing.txt"' },
            }),
        });
        const profile = { ...mockProfile, server: server.url.toString().replace(/\/$/, '') };

        try {
            await expect(handleModuleCommand(
                createClient(server.url.toString(), 'valid-token'),
                getModule('file')!,
                'download' as ModuleActionName,
                ['123'],
                profile,
                { output: dir },
            )).rejects.toMatchObject({ code: '2009' });
            expect(readFileSync(outputPath, 'utf8')).toBe('keep');
        } finally {
            server.stop(true);
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('delete confirmation prompt', () => {
    test('counts comma-separated ids instead of characters', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-cli-test-'));
        const configFile = join(dir, 'zentao.json');

        try {
            writeFileSync(configFile, JSON.stringify({
                currentProfile: `${mockProfile.account}@${mockProfile.server}`,
                profiles: [mockProfile],
                updateCheck: {
                    lastCheck: new Date().toISOString(),
                    latestVersion: '0.1.4',
                },
            }));

            const proc = Bun.spawn({
                cmd: [
                    process.execPath,
                    'src/index.ts',
                    '--config',
                    configFile,
                    'product',
                    'delete',
                    '1,2',
                ],
                cwd: process.cwd(),
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe',
                env: process.env,
            });

            proc.stdin.write('n\n');
            proc.stdin.end();

            const [stderr, exitCode] = await Promise.all([
                new Response(proc.stderr).text(),
                proc.exited,
            ]);

            expect(exitCode).toBe(0);
            expect(stderr).toContain('确认删除 2 个对象');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('handleModuleCommand raw output', () => {
    // 重构后 raw 输出为 zentao-api 归一化后的 ResponseData（status/data/pager）。
    test('prints normalized response for list commands', async () => {
        const client = {
            request: async () => ({
                status: 'success',
                products: [{ id: 1, name: '产品1' }],
                pager: { recTotal: 1, recPerPage: 20, pageID: 1 },
            }),
        } as unknown as ZentaoClient;

        const output = await captureConsoleLog(async () => {
            await handleModuleCommand(
                client,
                getModule('product')!,
                'list' as ModuleActionName,
                [],
                mockProfile,
                { format: 'raw' },
            );
        });

        const parsed = JSON.parse(output[0]);
        expect(parsed.status).toBe('success');
        expect(parsed.data).toEqual([{ id: 1, name: '产品1' }]);
        expect(parsed.pager).toEqual({ total: 1, page: 1, recPerPage: 20 });
    });

    test('prints normalized response for get commands', async () => {
        const client = {
            request: async () => ({
                status: 'success',
                user: { id: 1, realname: 'Admin' },
                serverTime: '2026-05-07T10:00:00Z',
            }),
        } as unknown as ZentaoClient;

        const output = await captureConsoleLog(async () => {
            await handleModuleCommand(
                client,
                getModule('user')!,
                'get' as ModuleActionName,
                ['1'],
                mockProfile,
                { format: 'raw' },
            );
        });

        const parsed = JSON.parse(output[0]);
        expect(parsed.status).toBe('success');
        expect(parsed.data).toEqual({ id: 1, realname: 'Admin' });
    });

    test('prints normalized response for write commands', async () => {
        const client = {
            request: async () => ({ status: 'success', id: 7, message: 'created' }),
        } as unknown as ZentaoClient;

        const output = await captureConsoleLog(async () => {
            await handleModuleCommand(
                client,
                getModule('user')!,
                'create' as ModuleActionName,
                [],
                mockProfile,
                {
                    format: 'raw',
                    account: 'dev1',
                    realname: 'Dev One',
                    password: 'secret',
                } as any,
            );
        });

        const parsed = JSON.parse(output[0]);
        expect(parsed.status).toBe('success');
        expect(parsed.data.id).toBe(7);
    });
});
