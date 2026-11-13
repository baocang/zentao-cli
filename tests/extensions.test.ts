import { describe, test, expect } from 'bun:test';
import { getModule } from '../src/modules';
import { applyRegistryExtensions } from '../src/modules/extensions';
import { normalizeIdLike } from '../src/modules/targets';
import { parseCliValue } from '../src/modules/cli-input';
import { actionContract } from '../src/modules/contract';

// Extensions must be applied before reading the registry below.
applyRegistryExtensions();

const HISTORY_DETAIL_MODULES: Array<{ module: string; detailPath: string; idKey: string }> = [
    { module: 'bug', detailPath: '/bugs/{bugID}', idKey: 'bugID' },
    { module: 'task', detailPath: '/tasks/{taskID}', idKey: 'taskID' },
    { module: 'story', detailPath: '/stories/{storyID}', idKey: 'storyID' },
    { module: 'testcase', detailPath: '/testcases/{caseID}', idKey: 'caseID' },
    { module: 'testtask', detailPath: '/testtasks/{testtaskID}', idKey: 'testtaskID' },
    { module: 'feedback', detailPath: '/feedbacks/{feedbackID}', idKey: 'feedbackID' },
    { module: 'build', detailPath: '/builds/{buildID}', idKey: 'buildID' },
    { module: 'release', detailPath: '/releases/{releaseID}', idKey: 'releaseID' },
    { module: 'productplan', detailPath: '/productplans/{planID}', idKey: 'planID' },
];

const HISTORY_AJAX_MODULES: Array<{ module: string; objectType: string; idKey: string }> = [
    { module: 'epic', objectType: 'story', idKey: 'storyID' },
    { module: 'requirement', objectType: 'story', idKey: 'storyID' },
    { module: 'ticket', objectType: 'ticket', idKey: 'ticketID' },
    { module: 'product', objectType: 'product', idKey: 'productID' },
    { module: 'project', objectType: 'project', idKey: 'projectID' },
    { module: 'execution', objectType: 'execution', idKey: 'executionID' },
    { module: 'program', objectType: 'program', idKey: 'programID' },
];

describe('registry extensions (history & comments)', () => {
    test('every object module has history and comment actions', () => {
        const modules = [...HISTORY_DETAIL_MODULES, ...HISTORY_AJAX_MODULES].map(entry => entry.module);
        expect(modules).toHaveLength(16);
        for (const name of modules) {
            const mod = getModule(name)!;
            expect(mod.actions.find(action => action.name === 'history')).toBeDefined();
            expect(mod.actions.find(action => action.name === 'comment')).toBeDefined();
        }
    });

    test('history reads the actions array from detail endpoints (no invented /actions route)', () => {
        for (const entry of HISTORY_DETAIL_MODULES) {
            const action = getModule(entry.module)!.actions.find(action => action.name === 'history')!;
            expect(action.path).toBe(entry.detailPath);
            expect(action.method).toBe('get');
            expect(action.resultGetter).toBe('actions');
            expect(action.type).toBe('list');
            expect(action.minVersion?.length).toBeGreaterThan(0);
        }
    });

    test('history falls back to ajaxGetList for modules whose detail lacks actions', () => {
        for (const entry of HISTORY_AJAX_MODULES) {
            const action = getModule(entry.module)!.actions.find(action => action.name === 'history')!;
            expect(action.path).toBe(`/action/ajaxGetList?objectType=${entry.objectType}&objectID={${entry.idKey}}`);
            expect(typeof action.resultGetter).toBe('function');
        }
    });

    test('ajaxGetList resultGetter converts the ID-keyed map to an array', () => {
        const action = getModule('product')!.actions.find(action => action.name === 'history')!;
        const getter = action.resultGetter as (response: unknown) => unknown[];
        const rows = getter({
            801665: { id: 801665, action: 'opened' },
            801666: { id: 801666, action: 'commented' },
            status: 'success',
        });
        expect(rows).toHaveLength(2);
        expect((rows[0] as { id: number }).id).toBe(801665);
    });

    test('comment posts to the action->comment fallback route with objectType in query', () => {
        const action = getModule('bug')!.actions.find(action => action.name === 'comment')!;
        expect(action.path).toBe('/actions/comment?objectType=bug&objectID={bugID}');
        expect(action.method).toBe('post');
        expect(action.requestBody?.schema).toMatchObject({
            type: 'object',
            required: ['comment'],
        });
        const epicComment = getModule('epic')!.actions.find(action => action.name === 'comment')!;
        expect(epicComment.path).toBe('/actions/comment?objectType=story&objectID={storyID}');
    });

    test('comment/history actions expose the object ID as the positional target', () => {
        const mod = getModule('bug')!;
        const history = mod.actions.find(action => action.name === 'history')!;
        expect(actionContract(mod, history).target).toBe('bugID');
        const comment = mod.actions.find(action => action.name === 'comment')!;
        expect(actionContract(mod, comment).target).toBe('bugID');
    });
});

describe('registry extensions (task effort)', () => {
    const task = () => getModule('task')!;

    test('recordestimate posts array-shaped fields to recordworkhour', () => {
        const action = task().actions.find(action => action.name === 'recordestimate')!;
        expect(action.method).toBe('put');
        expect(action.path).toBe('/tasks/{taskID}/recordworkhour');
        const schema = action.requestBody?.schema as { properties: Record<string, { type: string }>; required: string[] };
        expect(schema.properties.date.type).toBe('array');
        expect(schema.properties.consumed.type).toBe('array');
        expect(schema.properties.left.type).toBe('array');
        expect(schema.required).toContain('consumed');
        expect(schema.required).toContain('left');
    });

    test('effort reads recordworkhour with ID duplicated into query', () => {
        const action = task().actions.find(action => action.name === 'effort')!;
        expect(action.method).toBe('get');
        expect(action.path).toBe('/tasks/{taskID}/recordworkhour');
        expect(action.params?.some(param => param.name === 'taskID' && param.required)).toBe(true);
        expect(typeof action.resultGetter).toBe('function');
    });

    test('editeffort and deleteeffort operate on effort IDs', () => {
        const edit = task().actions.find(action => action.name === 'editeffort')!;
        expect(edit.path).toBe('/tasks/{effortID}/editeffort');
        const remove = task().actions.find(action => action.name === 'deleteeffort')!;
        expect(remove.method).toBe('delete');
        expect(remove.path).toBe('/tasks/{effortID}/deleteworkhour');
    });
});

describe('registry extensions (workflow actions)', () => {
    test('bug and feedback/ticket assignto exist', () => {
        expect(getModule('bug')!.actions.find(action => action.name === 'assignto')!.path).toBe('/bugs/{bugID}/assignto');
        expect(getModule('feedback')!.actions.find(action => action.name === 'assignto')!.path).toBe('/feedbacks/{feedbackID}/assignto');
        expect(getModule('ticket')!.actions.find(action => action.name === 'assignto')!.path).toBe('/tickets/{ticketID}/assignto');
    });

    test('task pause/cancel/restart/assignto exist', () => {
        const names = getModule('task')!.actions.map(action => action.name);
        for (const name of ['pause', 'cancel', 'restart', 'assignto']) expect(names).toContain(name);
    });

    test('story/epic/requirement review exists', () => {
        for (const name of ['story', 'epic', 'requirement']) {
            const review = getModule(name)!.actions.find(action => action.name === 'review');
            expect(review?.path).toBe(`/${name}s/{storyID}/review`);
        }
    });

    test('build/release/testtask get actions exist', () => {
        expect(getModule('build')!.actions.find(action => action.name === 'get')!.path).toBe('/builds/{buildID}');
        expect(getModule('release')!.actions.find(action => action.name === 'get')!.path).toBe('/releases/{releaseID}');
        expect(getModule('testtask')!.actions.find(action => action.name === 'get')!.path).toBe('/testtasks/{testtaskID}');
    });

    test('bug create/update accept deadline and module; project create requires desc', () => {
        for (const name of ['create', 'update']) {
            const schema = getModule('bug')!.actions.find(action => action.name === name)!.requestBody?.schema as {
                properties: Record<string, unknown>;
            };
            expect(schema.properties.deadline).toBeDefined();
            expect(schema.properties.module).toBeDefined();
        }
        const projectCreate = getModule('project')!.actions.find(action => action.name === 'create')!.requestBody?.schema as {
            properties: Record<string, unknown>;
            required: string[];
        };
        expect(projectCreate.properties.desc).toBeDefined();
        expect(projectCreate.required).toContain('desc');
    });

    test('applying extensions twice is safe', () => {
        const before = getModule('bug')!.actions.length;
        applyRegistryExtensions();
        expect(getModule('bug')!.actions.length).toBe(before);
    });
});

describe('prefixed ID normalization', () => {
    test('normalizeIdLike strips the prefix', () => {
        expect(normalizeIdLike('case_48')).toBe('48');
        expect(normalizeIdLike('bug_12')).toBe('12');
        expect(normalizeIdLike('48')).toBe('48');
        expect(normalizeIdLike('case_x')).toBe('case_x');
    });

    test('parseCliValue accepts prefixed IDs for numeric fields', () => {
        expect(parseCliValue('case_48', { type: 'integer' })).toBe(48);
        expect(parseCliValue('48', { type: 'integer' })).toBe(48);
    });

    test('parseCliValue rejects exponent notation', () => {
        expect(() => parseCliValue('1e2', { type: 'integer' })).toThrow();
        expect(() => parseCliValue('1e2', { type: 'number' })).toThrow();
    });

    test('batch --ids accepts prefixed IDs', async () => {
        const { batchTargets } = await import('../src/modules/targets');
        const action = getModule('testcase')!.actions.find(action => action.name === 'get')!;
        expect(batchTargets(action, {}, 'case_48,49')).toEqual([48, 49]);
    });
});
