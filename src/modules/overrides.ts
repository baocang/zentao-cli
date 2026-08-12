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
 * 3. 缺少的工作流操作（确认、指派、暂停、取消、继续、评审、测试单操作、反馈/工单指派等）。
 * 4. 操作历史与备注（history / comment），适用于所有业务对象模块。
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
        action('bug', 'confirm', '确认Bug', 'bugID', {
            properties: {
                assignedTo: { type: 'string', description: '指派给' },
                ...COMMENT_FIELD,
            },
        }),
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

    // ── Feedback：指派 ──
    defineModuleActions('feedback', [
        action('feedback', 'assignto', '指派反馈', 'feedbackID', {
            properties: ASSIGN_FIELDS,
            required: ['assignedTo'],
        }),
    ]);

    // ── Ticket：指派 ──
    defineModuleActions('ticket', [
        action('ticket', 'assignto', '指派工单', 'ticketID', {
            properties: ASSIGN_FIELDS,
            required: ['assignedTo'],
        }),
    ]);

    // ── File：修改附件名称（API v2 3.7.2 编辑附件） ──
    defineModuleActions('file', {
        name: 'update',
        display: '修改附件名称',
        type: 'update',
        method: 'put',
        path: '/files/{fileID}',
        resultType: 'text',
        pathParams: { fileID: '附件 ID' },
        requestBody: {
            required: true,
            type: 'object',
            schema: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: '新的附件名称' },
                },
                required: ['title'],
            },
        },
    });

    // ── Task：记录工时（逐条工作内容） ──
    // ZenTao 的 task->recordWorkhour 方法支持查看与批量新增任务工时条目，
    // REST API v2 路由为 PUT /tasks/{taskID}/recordworkhour。
    // 每条记录包含：日期、工作内容、耗时、剩余。
    defineModuleActions('task', {
        name: 'recordestimate',
        display: '记录任务工时',
        type: 'action',
        method: 'put',
        path: '/tasks/{taskID}/recordworkhour',
        resultType: 'text',
        pathParams: { taskID: '任务 ID' },
        requestBody: {
            required: true,
            type: 'object',
            schema: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: '日期，格式 YYYY-MM-DD，默认今天' },
                    work: { type: 'string', description: '工作内容' },
                    consumed: { type: 'number', description: '本次耗时（小时，会累加到总计消耗）', format: 'float' },
                    left: { type: 'number', description: '更新后的剩余工时（小时，覆盖之前的剩余值）', format: 'float' },
                },
                required: ['consumed', 'left'],
            },
        },
    });

    // ── Task：查看工时记录（逐条工作内容） ──
    // ZenTao 的 task->recordWorkhour 控制器方法在 GET 请求时返回现有工时表单。
    // REST API v2 的 routeV2 将 /tasks/{taskID}/recordworkhour 路由到该方法。
    // 响应格式可能包含表单元数据，resultGetter 留空以返回完整响应供用户判断。
    defineModuleActions('task', {
        name: 'effort',
        display: '获取任务工时记录',
        type: 'list',
        method: 'get',
        path: '/tasks/{taskID}/recordworkhour',
        resultType: 'list',
        pathParams: { taskID: '任务 ID' },
    });

    // ── Task：编辑工时记录 ──
    // ZenTao task->editEffort(effortID) 方法编辑单条工时。
    // routeV2 中 PUT /tasks/{effortID}/editeffort 通过 setParams() 的位置参数
    // 映射，将 path[1] 的 effortID 正确注入为方法的第一个参数。
    defineModuleActions('task', {
        name: 'editeffort',
        display: '编辑工时记录',
        type: 'action',
        method: 'put',
        path: '/tasks/{effortID}/editeffort',
        resultType: 'text',
        pathParams: { effortID: '工时记录 ID' },
        requestBody: {
            required: true,
            type: 'object',
            schema: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
                    work: { type: 'string', description: '工作内容' },
                    consumed: { type: 'number', description: '本次耗时（小时，会累加到总计消耗）', format: 'float' },
                    left: { type: 'number', description: '更新后的剩余工时（小时，覆盖之前的剩余值）', format: 'float' },
                },
                required: ['consumed', 'left'],
            },
        },
    });

    // ── Task：删除工时记录 ──
    // ZenTao task->deleteWorkhour(effortID) 方法删除单条工时。
    // routeV2 对 DELETE 请求自动设置 confirm=yes，跳过二次确认。
    defineModuleActions('task', {
        name: 'deleteeffort',
        display: '删除工时记录',
        type: 'delete',
        method: 'delete',
        path: '/tasks/{effortID}/deleteworkhour',
        resultType: 'text',
        pathParams: { effortID: '工时记录 ID' },
    });
}

// ──────────────────────────── 4. 历史记录与备注 ────────────────────────────

/**
 * 支持历史记录与备注的对象模块及其路径参数映射。
 *
 * ZenTao 的 action 模块提供跨模块的操作历史（opened/resolved/closed/commented 等）
 * 与备注（comment）能力。REST API v2 暴露为：
 *   GET  /actions/{objectType}/{objectID}  → 操作历史
 *   POST /actions/{objectType}/{objectID}  → 添加备注
 */
const HISTORY_MODULES: Array<{ module: string; objectType: string; idKey: string; display: string }> = [
    { module: 'bug', objectType: 'bug', idKey: 'bugID', display: 'Bug' },
    { module: 'task', objectType: 'task', idKey: 'taskID', display: '任务' },
    { module: 'story', objectType: 'story', idKey: 'storyID', display: '需求' },
    { module: 'epic', objectType: 'epic', idKey: 'epicID', display: '业务需求' },
    { module: 'requirement', objectType: 'requirement', idKey: 'requirementID', display: '用户需求' },
    { module: 'testcase', objectType: 'testcase', idKey: 'caseID', display: '用例' },
    { module: 'feedback', objectType: 'feedback', idKey: 'feedbackID', display: '反馈' },
    { module: 'ticket', objectType: 'ticket', idKey: 'ticketID', display: '工单' },
    { module: 'product', objectType: 'product', idKey: 'productID', display: '产品' },
    { module: 'project', objectType: 'project', idKey: 'projectID', display: '项目' },
    { module: 'execution', objectType: 'execution', idKey: 'executionID', display: '执行' },
    { module: 'build', objectType: 'build', idKey: 'buildID', display: '版本' },
    { module: 'release', objectType: 'release', idKey: 'releaseID', display: '发布' },
    { module: 'testtask', objectType: 'testtask', idKey: 'testtaskID', display: '测试单' },
    { module: 'productplan', objectType: 'productplan', idKey: 'productplanID', display: '计划' },
    { module: 'program', objectType: 'program', idKey: 'programID', display: '项目集' },
];

/**
 * 为所有业务对象模块添加 `history`（操作历史）和 `comment`（添加备注）扩展操作。
 *
 * 使用方式：
 *   zentao bug history 123            — 查看 Bug 123 的操作历史与备注
 *   zentao bug comment 123 --comment="备注内容"  — 为 Bug 123 添加备注
 *   zentao task history 456 --pick id,actor,action,date,comment  — 摘取指定字段
 */
function addActionHistoryAndComments(): void {
    for (const { module, objectType, idKey, display } of HISTORY_MODULES) {
        const pathParams: Record<string, string> = { [idKey]: `${display} ID` };

        // 操作历史：GET /actions/{objectType}/{objectID}
        // 使用 type: 'list' 使结果以表格输出并支持 --filter/--sort/--pick 等客户端处理。
        defineModuleActions(module, {
            name: 'history',
            display: `获取${display}历史记录`,
            type: 'list',
            method: 'get',
            path: `/actions/${objectType}/{${idKey}}`,
            resultType: 'list',
            resultGetter: 'actions',
            pathParams,
        });

        // 添加备注：POST /actions/{objectType}/{objectID}
        defineModuleActions(module, {
            name: 'comment',
            display: `添加${display}备注`,
            type: 'action',
            method: 'post',
            path: `/actions/${objectType}/{${idKey}}`,
            resultType: 'text',
            pathParams,
            requestBody: {
                required: true,
                type: 'object',
                schema: {
                    type: 'object',
                    properties: {
                        comment: { type: 'string', description: '备注内容' },
                    },
                    required: ['comment'],
                },
            },
        });
    }
}

// ──────────────────────────── 入口 ────────────────────────────

/** 应用禅道 22.4 兼容性覆盖，应在模块命令注册前调用 */
export function applyZentaoCompatibilityOverrides(): void {
    moveProductIDToQuery();
    addMissingCreateFields();
    fixResultGettersAndAddGetActions();
    addMissingWorkflowActions();
    addActionHistoryAndComments();
}
