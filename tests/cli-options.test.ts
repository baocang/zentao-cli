import { describe, expect, test } from 'bun:test';
import { applyOptionsJson } from '../src/utils/cli-options.js';
import { runCliWithoutAuth } from './helpers.js';

describe('applyOptionsJson', () => {
    test('uses options JSON as the base and lets explicit CLI values win', () => {
        const result = applyOptionsJson({
            options: JSON.stringify({ format: 'json', limit: '50', page: '2' }),
            format: 'raw',
            limit: '10',
        });

        expect(result).toEqual({ format: 'raw', limit: '10', page: '2' });
    });

    test('does not let Commander empty array defaults replace JSON values', () => {
        const result = applyOptionsJson({
            options: JSON.stringify({ filter: ['status=active'], search: ['keyword'] }),
            filter: [],
            search: [],
        });

        expect(result.filter).toEqual(['status=active']);
        expect(result.search).toEqual(['keyword']);
    });

    test('lets non-empty repeated CLI options replace JSON values', () => {
        const result = applyOptionsJson({
            options: JSON.stringify({ filter: ['status=active'], search: ['old'] }),
            filter: ['status=closed'],
            search: ['new'],
        });

        expect(result.filter).toEqual(['status=closed']);
        expect(result.search).toEqual(['new']);
    });

    test('preserves boolean flags supplied only through options JSON', () => {
        const result = applyOptionsJson({
            options: JSON.stringify({ insecure: true, silent: true, yes: true, all: true }),
            filter: [],
            search: [],
        });

        expect(result).toMatchObject({ insecure: true, silent: true, yes: true, all: true });
    });

    test('does not pass a nested options key to command execution', () => {
        const result = applyOptionsJson({
            options: JSON.stringify({ options: 'nested', format: 'json' }),
        });

        expect(result).toEqual({ format: 'json' });
    });

    test.each([
        ['invalid JSON', '{'],
        ['an array', '[]'],
        ['null', 'null'],
        ['a scalar', 'true'],
    ])('rejects %s', (_label, value) => {
        expect(() => applyOptionsJson({ options: value })).toThrow('选项 --options 的值无效');
    });
});

describe('--options command wiring', () => {
    test('validates --options before authentication on a module action', async () => {
        const result = await runCliWithoutAuth(['bug', 'get', '1', '--options', '[]']);

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('E2009');
        expect(result.stderr).toContain('--options');
        expect(result.stderr).not.toContain('E1006');
    });

    test('invalid JSON fails before authentication', async () => {
        const result = await runCliWithoutAuth(['bug', 'get', '1', '--options', '{']);

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('E2009');
        expect(result.stderr).not.toContain('E1006');
    });

    test('module commands still authenticate when --options is absent', async () => {
        const result = await runCliWithoutAuth(['bug', 'get', '1']);

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('E1006');
        expect(result.stderr).not.toContain('E2009');
    });
});
