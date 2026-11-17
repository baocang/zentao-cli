import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ZentaoClient } from '../src/api/index.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import { applyRegistryExtensions } from '../src/modules/extensions.js';
import { getModule } from '../src/modules/index.js';
import { executeModuleCommand } from '../src/modules/executor.js';
import { validateToolParams } from '../src/modules/validation.js';
import { getEnvCredentials } from '../src/auth/login.js';
import { embedCommentImages } from '../src/commands/module-handler.js';
import { runCliWithoutAuth } from './helpers.js';

applyRegistryExtensions();

describe('bare numeric ID dispatches to get', () => {
    test('zentao bug 12345 parses and reaches authentication instead of failing argv', async () => {
        const result = await runCliWithoutAuth(['bug', '12345']);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('E1006');
        expect(result.stderr).not.toContain('too many arguments');
    });

    test('a non-numeric bare token gets an actionable error naming the correct form', async () => {
        const result = await runCliWithoutAuth(['bug', 'wat']);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('zentao bug get');
    });
});

describe('sort expression validation', () => {
    function mockClient() {
        return {
            getZentaoConfig: async () => ({ version: '22.5' }),
            async request() {
                return {
                    bugs: [{ id: 1, title: 'a', pri: 2 }],
                    pager: { page: 1, recPerPage: 20, total: 1 },
                };
            },
        } as unknown as ZentaoClient;
    }

    test('rejects invalid syntax before any request', async () => {
        await expect(executeModuleCommand(
            mockClient(), getModule('bug')!, 'list', [], { sort: 'pri > 3' } as never, DEFAULT_CONFIG, { scope: 'products', scopeID: 18 },
        )).rejects.toThrow('无效的排序表达式');
    });

    test('rejects a sort field missing from the returned rows', async () => {
        await expect(executeModuleCommand(
            mockClient(), getModule('bug')!, 'list', [], { sort: 'editedDate:desc' } as never, DEFAULT_CONFIG, { scope: 'products', scopeID: 18 },
        )).rejects.toThrow('排序字段');
    });

    test('accepts a valid field with direction', async () => {
        const result = await executeModuleCommand(
            mockClient(), getModule('bug')!, 'list', [], { sort: 'pri:desc' } as never, DEFAULT_CONFIG, { scope: 'products', scopeID: 18 },
        );
        expect(result.isList).toBe(true);
    });
});

describe('update payloads reject the comment key (#26 guard)', () => {
    test('bug update with data.comment is refused with a pointer to the comment action', () => {
        const action = getModule('bug')!.actions.find(action => action.name === 'update')!;
        expect(() => validateToolParams(getModule('bug')!, action, {
            bugID: 1,
            data: { title: 'x', comment: 'hi' },
        })).toThrow('comment <id>');
    });

    test('flat comment param on update is refused too', () => {
        const action = getModule('bug')!.actions.find(action => action.name === 'update')!;
        expect(() => validateToolParams(getModule('bug')!, action, {
            bugID: 1,
            comment: 'hi',
        })).toThrow('update 请求不支持 comment 字段');
    });

    test('auditplan/baseline/weekly updates keep their legitimate comment field', () => {
        for (const name of ['auditplan', 'baseline', 'weekly']) {
            const mod = getModule(name)!;
            const action = mod.actions.find(action => action.name === 'update');
            if (!action) continue;
            const idKey = Object.keys(action.pathParams ?? {}).find(key => key.endsWith('ID'))!;
            expect(() => validateToolParams(mod, action, { [idKey]: 1, data: { comment: 'note' } })).not.toThrow();
        }
    });

    test('resolve/close still accept comment alongside status fields', () => {
        const mod = getModule('bug')!;
        const action = mod.actions.find(action => action.name === 'resolve')!;
        expect(() => validateToolParams(mod, action, {
            bugID: 1,
            resolution: 'fixed',
            comment: 'done',
        })).not.toThrow();
    });
});

describe('ZENTAO_CREDENTIALS_FILE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zentao-credfile-'));
    const filePath = join(dir, 'creds.env');

    function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
        const saved: Record<string, string | undefined> = {};
        for (const key of [...Object.keys(vars), 'ZENTAO_URL', 'ZENTAO_ACCOUNT', 'ZENTAO_PASSWORD', 'ZENTAO_TOKEN', 'ZENTAO_CREDENTIALS_FILE']) {
            saved[key] = process.env[key];
        }
        for (const [key, value] of Object.entries(vars)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        try {
            fn();
        } finally {
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    }

    test('fills credentials from a 0600 file', () => {
        writeFileSync(filePath, 'ZENTAO_URL=https://zentao.example.com\nZENTAO_ACCOUNT=bot\nZENTAO_PASSWORD=secret\n');
        chmodSync(filePath, 0o600);
        withEnv({ ZENTAO_CREDENTIALS_FILE: filePath }, () => {
            expect(getEnvCredentials()).toMatchObject({
                url: 'https://zentao.example.com',
                account: 'bot',
                password: 'secret',
            });
        });
    });

    test('real environment variables win over the file', () => {
        writeFileSync(filePath, 'ZENTAO_ACCOUNT=fromfile\n', undefined as never);
        chmodSync(filePath, 0o600);
        withEnv({
            ZENTAO_CREDENTIALS_FILE: filePath,
            ZENTAO_ACCOUNT: 'fromenv',
        }, () => {
            expect(getEnvCredentials().account).toBe('fromenv');
        });
    });

    test('rejects a world-readable credentials file', () => {
        writeFileSync(filePath, 'ZENTAO_ACCOUNT=bot\n');
        chmodSync(filePath, 0o644);
        withEnv({ ZENTAO_CREDENTIALS_FILE: filePath }, () => {
            expect(() => getEnvCredentials()).toThrow('chmod 600');
        });
    });

    test('missing file yields a clear error', () => {
        withEnv({ ZENTAO_CREDENTIALS_FILE: join(dir, 'nope.env') }, () => {
            expect(() => getEnvCredentials()).toThrow('无法读取凭据文件');
        });
    });

    test('cleans up', () => {
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('comment --image embedding', () => {
    const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

    function mockUploadClient(id: number, url: string) {
        const calls: Array<{ path: string; body?: unknown }> = [];
        return {
            calls,
            client: {
                getZentaoConfig: async () => ({ version: '22.5' }),
                async request(path: string, options?: { body?: unknown }) {
                    calls.push({ path, body: options?.body });
                    if (path === '/files') return { status: 'success', id, url };
                    throw new Error(`unexpected ${path}`);
                },
            } as unknown as ZentaoClient,
        };
    }

    test('uploads each image and appends inline img markup to the comment', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-img-'));
        try {
            const shot = join(dir, 'shot.png');
            writeFileSync(shot, pngBytes);
            const { client, calls } = mockUploadClient(1096300, '/file-read-1096300.png');
            const params = await embedCommentImages(client, getModule('bug')!, { bugID: 24298, data: { comment: '验证截图' } }, [shot]);
            expect(calls).toHaveLength(1);
            expect(String((params.data as Record<string, unknown>).comment)).toContain('验证截图');
            expect(String((params.data as Record<string, unknown>).comment)).toContain('<img src="/file-read-1096300.png"');
            const form = calls[0].body as FormData;
            expect(form).toBeInstanceOf(FormData);
            expect(form.get('objectType')).toBe('bug');
            expect(form.get('objectID')).toBe('24298');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('uses the story objectType for epic comments', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-img-'));
        try {
            const shot = join(dir, 'e.png');
            writeFileSync(shot, pngBytes);
            const { client, calls } = mockUploadClient(1, '/file-read-1.png');
            await embedCommentImages(client, getModule('epic')!, { storyID: 5, data: { comment: 'x' } }, [shot]);
            expect((calls[0].body as FormData).get('objectType')).toBe('story');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('rejects a missing image file with a clear error', async () => {
        await expect(embedCommentImages(
            mockUploadClient(1, '').client, getModule('bug')!, { bugID: 1, data: { comment: 'x' } }, ['/tmp/nope-does-not-exist.png'],
        )).rejects.toThrow('图片文件不存在');
    });

    test('rejects unsupported extensions', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'zentao-img-'));
        try {
            const doc = join(dir, 'doc.txt');
            writeFileSync(doc, 'x');
            await expect(embedCommentImages(
                mockUploadClient(1, '').client, getModule('bug')!, { bugID: 1, data: { comment: 'x' } }, [doc],
            )).rejects.toThrow('不支持的图片格式');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('story create gains the plan field', () => {
    test('plan is declared as a numeric array', () => {
        const action = getModule('story')!.actions.find(action => action.name === 'create')!;
        const plan = (action.requestBody!.schema as { properties: Record<string, { type: string; items?: { type: string } }> }).properties.plan;
        expect(plan.type).toBe('array');
        expect(plan.items?.type).toBe('number');
    });
});
