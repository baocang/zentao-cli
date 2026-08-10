import { describe, test, expect } from 'bun:test';
import { getModule, getModuleNames, isModuleName, getAllModules } from '../src/modules';
import { findAction, getAvailableActions, getAction } from '../src/modules';
import { buildParams } from '../src/modules/args';
import { applyZentaoCompatibilityOverrides } from '../src/modules/overrides';

describe('module registry (zentao-api)', () => {
    test('contains expected modules', () => {
        const names = getModuleNames();
        expect(names).toContain('product');
        expect(names).toContain('bug');
        expect(names).toContain('task');
        expect(names).toContain('story');
        expect(names).toContain('user');
        expect(names.length).toBeGreaterThanOrEqual(19);
    });

    test('getAllModules returns every registered module', () => {
        expect(getAllModules().length).toBe(getModuleNames().length);
    });

    test('getModule returns module by name', () => {
        const mod = getModule('product');
        expect(mod).toBeDefined();
        expect(mod!.name).toBe('product');
        const listAction = findAction(mod!, 'list');
        expect(listAction).toBeDefined();
        expect(listAction!.path).toBe('/products');
    });

    test('getModule is case insensitive', () => {
        expect(getModule('Product')).toBeDefined();
        expect(getModule('BUG')).toBeDefined();
    });

    test('getModule returns undefined for unknown module', () => {
        expect(getModule('nonexistent')).toBeUndefined();
    });

    test('isModuleName identifies valid modules', () => {
        expect(isModuleName('product')).toBe(true);
        expect(isModuleName('unknown')).toBe(false);
    });

    test('bug module has correct actions', () => {
        const bug = getModule('bug')!;
        const actions = bug.actions.map((a) => a.name);
        expect(actions).toContain('resolve');
        expect(actions).toContain('close');
        expect(actions).toContain('activate');
    });

    test('task module has correct actions', () => {
        const task = getModule('task')!;
        const actions = task.actions.map((a) => a.name);
        expect(actions).toContain('start');
        expect(actions).toContain('finish');
        expect(actions).toContain('close');
        expect(actions).toContain('activate');
    });

    test('product module has list operation', () => {
        const product = getModule('product')!;
        const listAction = findAction(product, 'list');
        expect(listAction).toBeDefined();
        expect(listAction!.name).toBe('list');
    });

    test('bug module has no top-level list (scoped list)', () => {
        const bug = getModule('bug')!;
        const listAction = findAction(bug, 'list');
        expect(listAction).toBeDefined();
        expect(listAction!.path).toBe('/{scope}/{scopeID}/bugs');
    });
});

describe('action lookup', () => {
    test('getAction resolves ls alias to list', () => {
        const mod = getModule('product')!;
        expect(getAction(mod, 'ls')?.type).toBe('list');
        expect(getAction(mod, 'list')?.type).toBe('list');
    });

    test('getAction resolves extension actions', () => {
        const mod = getModule('bug')!;
        expect(getAction(mod, 'resolve')?.name).toBe('resolve');
    });

    test('getAction returns undefined for unknown action', () => {
        const mod = getModule('bug')!;
        expect(getAction(mod, 'nonexistent')).toBeUndefined();
    });

    test('getAvailableActions returns action names', () => {
        const mod = getModule('story')!;
        const actions = getAvailableActions(mod);
        expect(actions).toContain('change');
        expect(actions).toContain('close');
        expect(actions).toContain('activate');
    });
});

describe('buildParams (argv parsing)', () => {
    test('positional numeric id becomes params.id', () => {
        const params = buildParams({}, 'update', ['1', '--name=产品1']);
        expect(params.id).toBe('1');
        expect(params.name).toBe('产品1');
    });

    test('positional id for delete', () => {
        const params = buildParams({}, 'delete', ['1']);
        expect(params.id).toBe('1');
    });

    test('positional JSON object becomes params.data', () => {
        const params = buildParams({}, 'create', ['{"title":"hi"}']);
        expect(params.data).toBe('{"title":"hi"}');
    });

    test('--params JSON is merged', () => {
        const params = buildParams({ params: '{"severity":2}' }, 'create', []);
        expect(params.severity).toBe(2);
    });

    test('--key=value coerces basic types', () => {
        const params = buildParams({}, 'create', ['--num=3', '--flag=true', '--name=foo']);
        expect(params.num).toBe(3);
        expect(params.flag).toBe(true);
        expect(params.name).toBe('foo');
    });

    test('repeated --key value accumulates as comma-separated (issue #5)', () => {
        const params = buildParams({}, 'create', ['--reviewer', 'user1', '--reviewer', 'user2']);
        expect(params.reviewer).toBe('user1,user2');
    });

    test('repeated --key=value accumulates as comma-separated (issue #5)', () => {
        const params = buildParams({}, 'create', ['--reviewer=user1', '--reviewer=user2']);
        expect(params.reviewer).toBe('user1,user2');
    });

    test('negative number value via space form is accepted (issue #6)', () => {
        const params = buildParams({}, 'create', ['--estimate', '-1']);
        expect(params.estimate).toBe(-1);
    });

    test('dash-leading string value via space form is accepted (issue #6)', () => {
        const params = buildParams({}, 'create', ['--name', '-test']);
        expect(params.name).toBe('-test');
    });

    test('bare flag without value becomes true (issue #6)', () => {
        const params = buildParams({}, 'create', ['--deleted', '--pri', '3']);
        expect(params.deleted).toBe(true);
        expect(params.pri).toBe(3);
    });

    test('invalid --data JSON throws E2007 (issue #9)', () => {
        expect(() => buildParams({ data: 'not-json' }, 'create', [])).toThrow(/E2007|--data/);
    });

    test('invalid positional JSON throws E2007 (issue #9)', () => {
        expect(() => buildParams({}, 'create', ['{"invalid": }'])).toThrow(/E2007|--data/);
    });

    test('valid --data JSON passes validation (issue #9)', () => {
        const params = buildParams({ data: '{"name":"ok"}' }, 'create', []);
        expect(params.data).toBe('{"name":"ok"}');
    });
});

describe('22.4 compatibility overrides', () => {
    test('project create accepts desc in request schema', () => {
        applyZentaoCompatibilityOverrides();

        const project = getModule('project')!;
        const createAction = findAction(project, 'create')!;
        const schema = createAction.requestBody?.schema as
            | { properties?: Record<string, unknown>; required?: string[] }
            | undefined;

        expect(schema?.properties?.desc).toBeDefined();
        expect(schema?.required).toContain('desc');
    });
});

describe('action history & comments (overrides)', () => {
    // Apply overrides once for all tests in this group.
    applyZentaoCompatibilityOverrides();

    const EXPECTED_HISTORY_MODULES = [
        'bug', 'task', 'story', 'epic', 'requirement', 'testcase',
        'feedback', 'ticket', 'product', 'project', 'execution',
        'build', 'release', 'testtask', 'productplan', 'program',
    ];

    test('every object module has a history action', () => {
        for (const name of EXPECTED_HISTORY_MODULES) {
            const mod = getModule(name)!;
            const historyAction = mod.actions.find(a => a.name === 'history');
            expect(historyAction).toBeDefined();
            expect(historyAction!.method).toBe('get');
            expect(historyAction!.path).toMatch(/^\/actions\//);
        }
    });

    test('every object module has a comment action', () => {
        for (const name of EXPECTED_HISTORY_MODULES) {
            const mod = getModule(name)!;
            const commentAction = mod.actions.find(a => a.name === 'comment');
            expect(commentAction).toBeDefined();
            expect(commentAction!.method).toBe('post');
            expect(commentAction!.path).toMatch(/^\/actions\//);
        }
    });

    test('history action uses list type with actions resultGetter', () => {
        const bug = getModule('bug')!;
        const history = bug.actions.find(a => a.name === 'history')!;
        expect(history.type).toBe('list');
        expect(history.resultGetter).toBe('actions');
    });

    test('comment action has required comment body field', () => {
        const task = getModule('task')!;
        const comment = task.actions.find(a => a.name === 'comment')!;
        const schema = comment.requestBody?.schema as
            | { properties?: Record<string, unknown>; required?: string[] }
            | undefined;
        expect(schema?.properties?.comment).toBeDefined();
        expect(schema?.required).toContain('comment');
    });

    test('history action path includes correct objectType', () => {
        const bug = getModule('bug')!;
        const history = bug.actions.find(a => a.name === 'history')!;
        expect(history.path).toBe('/actions/bug/{bugID}');

        const testcase = getModule('testcase')!;
        const testcaseHistory = testcase.actions.find(a => a.name === 'history')!;
        expect(testcaseHistory.path).toBe('/actions/testcase/{caseID}');
    });

    test('getAction resolves history (non-CRUD, type=list) by name', () => {
        const bug = getModule('bug')!;
        const resolved = getAction(bug, 'history');
        expect(resolved).toBeDefined();
        expect(resolved!.name).toBe('history');
        expect(resolved!.type).toBe('list');
    });

    test('getAction resolves comment (non-CRUD, type=action) by name', () => {
        const task = getModule('task')!;
        const resolved = getAction(task, 'comment');
        expect(resolved).toBeDefined();
        expect(resolved!.name).toBe('comment');
    });

    test('getAvailableActions includes history and comment', () => {
        const story = getModule('story')!;
        const actions = getAvailableActions(story);
        expect(actions).toContain('history');
        expect(actions).toContain('comment');
    });
});

describe('missing workflow actions (overrides)', () => {
    applyZentaoCompatibilityOverrides();

    test('feedback has assignto action', () => {
        const feedback = getModule('feedback')!;
        const assignto = feedback.actions.find(a => a.name === 'assignto');
        expect(assignto).toBeDefined();
        expect(assignto!.type).toBe('action');
        expect(assignto!.path).toBe('/feedbacks/{feedbackID}/assignto');
    });

    test('ticket has assignto action', () => {
        const ticket = getModule('ticket')!;
        const assignto = ticket.actions.find(a => a.name === 'assignto');
        expect(assignto).toBeDefined();
        expect(assignto!.type).toBe('action');
        expect(assignto!.path).toBe('/tickets/{ticketID}/assignto');
    });

    test('task has recordestimate action for work logs', () => {
        const task = getModule('task')!;
        const recordestimate = task.actions.find(a => a.name === 'recordestimate');
        expect(recordestimate).toBeDefined();
        expect(recordestimate!.type).toBe('action');
        expect(recordestimate!.method).toBe('put');
        expect(recordestimate!.path).toBe('/tasks/{taskID}/recordworkhour');

        const schema = recordestimate!.requestBody?.schema as
            | { properties?: Record<string, unknown>; required?: string[] }
            | undefined;
        expect(schema?.properties?.consumed).toBeDefined();
        expect(schema?.properties?.left).toBeDefined();
        expect(schema?.properties?.work).toBeDefined();
        expect(schema?.properties?.date).toBeDefined();
        expect(schema?.required).toContain('consumed');
        expect(schema?.required).toContain('left');
    });

    test('task has effort action for viewing work log entries', () => {
        const task = getModule('task')!;
        const effort = task.actions.find(a => a.name === 'effort');
        expect(effort).toBeDefined();
        expect(effort!.type).toBe('list');
        expect(effort!.method).toBe('get');
        expect(effort!.path).toBe('/tasks/{taskID}/recordworkhour');
    });

    test('getAction resolves effort and recordestimate', () => {
        const task = getModule('task')!;
        expect(getAction(task, 'effort')?.name).toBe('effort');
        expect(getAction(task, 'recordestimate')?.name).toBe('recordestimate');
    });

    test('bug confirm includes assignedTo field', () => {
        const bug = getModule('bug')!;
        const confirm = bug.actions.find(a => a.name === 'confirm')!;
        const schema = confirm.requestBody?.schema as
            | { properties?: Record<string, unknown> }
            | undefined;
        expect(schema?.properties?.assignedTo).toBeDefined();
        expect(schema?.properties?.comment).toBeDefined();
    });

    test('file has update action for renaming', () => {
        const file = getModule('file')!;
        const update = file.actions.find(a => a.name === 'update');
        expect(update).toBeDefined();
        expect(update!.type).toBe('update');
        expect(update!.method).toBe('put');
        expect(update!.path).toBe('/files/{fileID}');
    });
});

describe('bugfixes', () => {
    applyZentaoCompatibilityOverrides();

    test('buildParams does not treat 1e2 or 0x10 as numeric ID', () => {
        const params = buildParams({}, 'get', ['1e2']);
        expect(params.id).toBeUndefined();

        const params2 = buildParams({}, 'get', ['0x10']);
        expect(params2.id).toBeUndefined();
    });

    test('buildParams treats plain integer as numeric ID', () => {
        const params = buildParams({}, 'get', ['123']);
        expect(params.id).toBe('123');
    });

    test('applyOptionsJson removes residual options field', () => {
        const { applyOptionsJson } = require('../src/utils/cli-options');
        const result = applyOptionsJson({
            options: '{"format":"json"}',
            format: 'json',
        } as any);
        expect(result.options).toBeUndefined();
        expect(result.format).toBe('json');
    });
});
