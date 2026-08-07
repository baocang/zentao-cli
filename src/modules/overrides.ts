/**
 * 禅道 22.4 兼容性覆盖。
 *
 * `zentao-api` 内置模块注册表由 OpenAPI 数据自动生成，部分定义与禅道 22.4 实际
 * REST 行为存在差异。这里在 CLI 启动时统一修正，使 `help` 中展示的参数能够被
 * AI / 用户直接使用而无需特殊技巧。
 *
 * 修正类别：
 * 1. 产品维度创建接口的 `productID` 必须作为查询参数传递。
 * 2. 缺少 `resultGetter` 或缺少 `get` 动作的模块。
 * 3. 缺少的工作流操作（确认、指派、暂停、取消、继续、评审、测试单操作等）。
 */
import { defineModuleActions, extendModuleAction } from 'zentao-api';
import type { ModuleAction, ModuleActionParam } from '../types/index.js';

// ──────────────────────────── 辅助构造 ────────────────────────────

type PropertyDef = { type?: string; description?: string; format?: string };

/** 构造标准 action 动作定义（PUT + resultType text） */
function action(
    moduleName: string,
    name: string,
    display: string,
    idKey: string,
    extra?: {
        query?: ModuleActionParam[];
        properties?: Record<string, PropertyDef>;
        required?: string[];
    },
): ModuleAction {
    const pathParams: Record<string, string> = { [idKey]: `${moduleName} ID` };
    const result: ModuleAction = {
        name,
        display,
        type: 'action',
        method: 'put',
        path: `/${moduleName}s/{${idKey}}/${name}`,
        resultType: 'text',
        pathParams,
    };
    if (extra?.query) {
        result.params = extra.query;
    }
    if (extra?.properties || extra?.required) {
        result.requestBody = {
            required: true,
            type: 'object',
            schema: {
                type: 'object',
                properties: extra?.properties ?? {},
                required: extra?.required ?? [],
            },
        };
    }
    return result;
}

/** 指派操作通用 requestBody 字段 */
const ASSIGN_FIELDS: Record<string, PropertyDef> = {
    assignedTo: { type: 'string', description: '指派给' },
    comment: { type: 'string', description: '备注' },
};

const COMMENT_FIELD: Record<string, PropertyDef> = {
    comment: { type: 'string', description: '备注' },
};

const REVIEW_RESULT_OPTIONS = [
    { value: 'pass', label: '通过' },
    { value: 'reject', label: '拒绝' },
    { value: 'clarify', label: '需澄清' },
];

// ──────────────────────────── 1. productID 查询参数 ────────────────────────────

const PRODUCT_SCOPED_CREATE_MODULES = [
    'productplan',
    'story',
    'epic',
    'requirement',
    'bug',
    'testcase',
    'system',
    'testtask',
    'release',
];

function moveProductIDToQuery(): void {
    for (const moduleName of PRODUCT_SCOPED_CREATE_MODULES) {
        extendModuleAction(moduleName, 'create', (act) => {
            const schema = act.requestBody?.schema as
                | { properties?: Record<string, unknown>; required?: string[] }
                | undefined;

            if (schema?.properties && 'productID' in schema.properties) {
                delete schema.properties.productID;
            }
            if (schema?.required) {
                schema.required = schema.required.filter((field) => field !== 'productID');
            }

            const params = act.params ? [...act.params] : [];
            if (!params.some((param) => param.name === 'productID')) {
                params.unshift({
                    name: 'productID',
                    required: true,
                    type: 'number',
                    description: '产品ID',
                });
            }
            act.params = params;

            return act;
        });
    }
}

function addMissingCreateFields(): void {
    extendModuleAction('project', 'create', (act) => {
        const schema = act.requestBody?.schema as
            | { properties?: Record<string, PropertyDef>; required?: string[] }
            | undefined;

        if (!schema) return act;

        schema.properties = {
            ...(schema.properties ?? {}),
            desc: { type: 'string', description: '项目描述' },
        };

        if (!schema.required?.includes('desc')) {
            schema.required = [...(schema.required ?? []), 'desc'];
        }

        return act;
    });
}

// ──────────────────────────── 2. resultGetter 与 get 动作 ────────────────────────────

function fixResultGettersAndAddGetActions(): void {
    extendModuleAction('task', 'get', { resultGetter: 'task' });
    extendModuleAction('system', 'list', { resultGetter: 'systems' });

    const getActions: Array<{ module: string; display: string; idKey: string; resultGetter: string }> = [
        { module: 'project', display: '获取项目详情', idKey: 'projectID', resultGetter: 'project' },
        { module: 'build', display: '获取版本详情', idKey: 'buildID', resultGetter: 'build' },
        { module: 'release', display: '获取发布详情', idKey: 'releaseID', resultGetter: 'release' },
        { module: 'system', display: '获取应用详情', idKey: 'systemID', resultGetter: 'system' },
        { module: 'testtask', display: '获取测试单详情', idKey: 'testtaskID', resultGetter: 'testtask' },
    ];

    for (const def of getActions) {
        const getAction: ModuleAction = {
            name: 'get',
            display: def.display,
            type: 'get',
            method: 'get',
            path: `/${def.module}s/{${def.idKey}}`,
            resultType: 'object',
            resultGetter: def.resultGetter,
            pathParams: { [def.idKey]: `${def.module}ID` },
        };
        defineModuleActions(def.module, getAction);
    }
}

// ──────────────────────────── 3. 缺失的工作流操作 ────────────────────────────

function addMissingWorkflowActions(): void {
    // ── Bug：确认、指派 ──
    defineModuleActions('bug', [
        action('bug', 'confirm', '确认Bug', 'bugID', { properties: COMMENT_FIELD }),
        action('bug', 'assignto', '指派Bug', 'bugID', {
            properties: ASSIGN_FIELDS,
            required: ['assignedTo'],
        }),
    ]);

    // ── Task：暂停、取消、继续、指派 ──
    defineModuleActions('task', [
        action('task', 'pause', '暂停任务', 'taskID', { properties: COMMENT_FIELD }),
        action('task', 'cancel', '取消任务', 'taskID', { properties: COMMENT_FIELD }),
        action('task', 'restart', '继续任务', 'taskID', {
            properties: {
                realStarted: { type: 'string', description: '实际开始' },
                consumed: { type: 'number', description: '总计消耗', format: 'float' },
                left: { type: 'number', description: '预计剩余', format: 'float' },
                comment: { type: 'string', description: '备注' },
            },
            required: ['realStarted'],
        }),
        action('task', 'assignto', '指派任务', 'taskID', {
            query: [{ name: 'executionID', required: true, type: 'number', description: '执行ID' }],
            properties: {
                assignedTo: { type: 'string', description: '指派给' },
                left: { type: 'number', description: '预计剩余', format: 'float' },
                comment: { type: 'string', description: '备注' },
            },
            required: ['assignedTo', 'left'],
        }),
    ]);

    // ── Story / Epic / Requirement：评审、指派 ──
    const storyLike = (module: string, idKey: string, displayPrefix: string) => [
        action(module, 'review', `${displayPrefix}评审`, idKey, {
            properties: {
                assignedTo: { type: 'string', description: '指派给' },
                result: { type: 'string', description: '评审结果' },
                reviewedDate: { type: 'string', description: '评审时间' },
                comment: { type: 'string', description: '备注' },
            },
            required: ['result', 'reviewedDate', 'comment'],
        }),
        action(module, 'assignto', `${displayPrefix}指派`, idKey, {
            properties: ASSIGN_FIELDS,
            required: ['assignedTo'],
        }),
    ];
    defineModuleActions('story', storyLike('story', 'storyID', '需求'));
    defineModuleActions('epic', storyLike('epic', 'epicID', '业务需求'));
    defineModuleActions('requirement', storyLike('requirement', 'requirementID', '用户需求'));

    // ── Testcase：评审（caseID 需同时作为查询参数） ──
    defineModuleActions('testcase', [
        action('testcase', 'review', '评审用例', 'caseID', {
            query: [{ name: 'caseID', required: true, type: 'number', description: '用例ID' }],
            properties: {
                assignedTo: { type: 'string', description: '指派给' },
                result: { type: 'string', description: '评审结果' },
                reviewedDate: { type: 'string', description: '评审时间' },
                comment: { type: 'string', description: '备注' },
            },
            required: ['result', 'reviewedDate'],
        }),
    ]);

    // ── Testtask：开始、关闭、激活、阻塞 ──
    defineModuleActions('testtask', [
        action('testtask', 'start', '开始测试单', 'testtaskID', {
            properties: { name: { type: 'string', description: '测试单名称' } },
        }),
        action('testtask', 'close', '关闭测试单', 'testtaskID', { properties: COMMENT_FIELD }),
        action('testtask', 'activate', '激活测试单', 'testtaskID', {
            properties: {
                build: { type: 'string', description: '测试版本' },
                comment: { type: 'string', description: '备注' },
            },
        }),
        action('testtask', 'block', '阻塞测试单', 'testtaskID', { properties: COMMENT_FIELD }),
    ]);
}

// ──────────────────────────── 入口 ────────────────────────────

/** 应用禅道 22.4 兼容性覆盖，应在模块命令注册前调用 */
export function applyZentaoCompatibilityOverrides(): void {
    moveProductIDToQuery();
    addMissingCreateFields();
    fixResultGettersAndAddGetActions();
    addMissingWorkflowActions();
}
