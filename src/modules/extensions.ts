/**
 * Registry extensions for capabilities the pinned zentao-api registry lacks.
 *
 * Wire-level facts these definitions rely on (verified against ZenTao 22.5 on
 * 2026-11-13; see CHANGES.md):
 * - API v2 has NO /actions/{objectType}/{objectID} route. That path resolves
 *   through the generic fallback router to module `action` + method `<numeric
 *   id>`, which fails privilege checks for every non-admin account (403).
 * - Action history is embedded in detail responses as a top-level `actions`
 *   array for bug/story/task/testcase/testtask/feedback/build/release and
 *   productplan. Modules whose detail response lacks it use the
 *   GET /action/ajaxGetList fallback (allowed via action.comment privilege).
 * - Comments are written via POST /actions/comment?objectType=..&objectID=..
 *   (2-segment fallback route to action->comment; returns
 *   {status:'success',data:<actionID>}).
 * - Task effort lives on /tasks/{id}/recordworkhour; ZenTao expects batch
 *   array-shaped body fields (form::batchData) and, for GET/3-segment paths,
 *   the ID must be duplicated into the query string.
 */
import { defineModuleActions, extendModuleAction } from 'zentao-api';
import type { ModuleAction, ModuleActionParam } from '../types/index.js';

/** Edition-matched minimum version for every extension action (mirrors SDK conventions). */
const MIN_VERSION = ['22.0', 'biz13.0', 'max8.0', 'ipd5.0'];

type PropertyDef = { type?: string; description?: string; format?: string; items?: unknown; options?: Array<{ value: string; label: string }> };

/** Standard PUT workflow action on /{module}s/{idKey}/{name}. */
function workflowAction(
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
    const result: ModuleAction = {
        name,
        display,
        type: 'action',
        method: 'put',
        path: `/${moduleName}s/{${idKey}}/${name}`,
        resultType: 'text',
        minVersion: MIN_VERSION,
        pathParams: { [idKey]: `${moduleName} ID` },
    };
    if (extra?.query) result.params = extra.query;
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

// ──────────────────────────── 1. Missing workflow actions ────────────────────────────

function addMissingWorkflowActions(): void {
    defineModuleActions('bug', [
        workflowAction('bug', 'assignto', '指派Bug', 'bugID', {
            properties: ASSIGN_FIELDS,
            required: ['assignedTo'],
        }),
    ]);

    defineModuleActions('task', [
        workflowAction('task', 'pause', '暂停任务', 'taskID', { properties: COMMENT_FIELD }),
        workflowAction('task', 'cancel', '取消任务', 'taskID', { properties: COMMENT_FIELD }),
        workflowAction('task', 'restart', '继续任务', 'taskID', {
            properties: {
                realStarted: { type: 'string', description: '实际开始' },
                consumed: { type: 'number', description: '总计消耗', format: 'float' },
                left: { type: 'number', description: '预计剩余', format: 'float' },
                comment: { type: 'string', description: '备注' },
            },
            required: ['realStarted'],
        }),
        workflowAction('task', 'assignto', '指派任务', 'taskID', {
            query: [{ name: 'executionID', required: true, type: 'number', description: '执行ID' }],
            properties: {
                assignedTo: { type: 'string', description: '指派给' },
                left: { type: 'number', description: '预计剩余', format: 'float' },
                comment: { type: 'string', description: '备注' },
            },
            required: ['assignedTo', 'left'],
        }),
    ]);

    // story-family review (epic/requirement are UR/SR variants stored as stories)
    const storyLikeModules: Array<{ module: string; idKey: string; displayPrefix: string }> = [
        { module: 'story', idKey: 'storyID', displayPrefix: '需求' },
        { module: 'epic', idKey: 'storyID', displayPrefix: '业务需求' },
        { module: 'requirement', idKey: 'storyID', displayPrefix: '用户需求' },
    ];
    for (const { module, idKey, displayPrefix } of storyLikeModules) {
        defineModuleActions('story' === module ? 'story' : module, [
            workflowAction(module, 'review', `${displayPrefix}评审`, idKey, {
                properties: {
                    assignedTo: { type: 'string', description: '指派给' },
                    result: { type: 'string', description: '评审结果', options: REVIEW_RESULT_OPTIONS },
                    reviewedDate: { type: 'string', description: '评审时间' },
                    comment: { type: 'string', description: '备注' },
                },
                required: ['result', 'reviewedDate', 'comment'],
            }),
        ]);
    }

    defineModuleActions('feedback', [
        workflowAction('feedback', 'assignto', '指派反馈', 'feedbackID', {
            properties: ASSIGN_FIELDS,
            required: ['assignedTo'],
        }),
    ]);

    defineModuleActions('ticket', [
        workflowAction('ticket', 'assignto', '指派工单', 'ticketID', {
            properties: ASSIGN_FIELDS,
            required: ['assignedTo'],
        }),
    ]);
}

// ──────────────────────────── 2. Task effort suite ────────────────────────────

function addTaskEffortActions(): void {
    defineModuleActions('task', [
        {
            name: 'recordestimate',
            display: '记录任务工时',
            type: 'action',
            method: 'put',
            path: '/tasks/{taskID}/recordworkhour',
            resultType: 'text',
            minVersion: MIN_VERSION,
            pathParams: { taskID: '任务 ID' },
            requestBody: {
                required: true,
                type: 'object',
                schema: {
                    type: 'object',
                    properties: {
                        date: { type: 'array', items: { type: 'string' }, description: '日期，格式 YYYY-MM-DD，默认今天' },
                        work: { type: 'array', items: { type: 'string' }, description: '工作内容' },
                        consumed: { type: 'array', items: { type: 'number' }, description: '本次耗时（小时，累加到总计）' },
                        left: { type: 'array', items: { type: 'number' }, description: '更新后的剩余工时（小时，覆盖之前值）' },
                    },
                    required: ['date', 'consumed', 'left'],
                },
            },
        },
        {
            // routeV2 does not inject the path numeric ID into $_GET for GET
            // requests on 3-segment paths, so taskID is duplicated as a query param.
            name: 'effort',
            display: '获取任务工时记录',
            type: 'list',
            method: 'get',
            path: '/tasks/{taskID}/recordworkhour',
            resultType: 'list',
            minVersion: MIN_VERSION,
            pathParams: { taskID: '任务 ID' },
            params: [{ name: 'taskID', required: true, type: 'number', description: '任务 ID' }],
            resultGetter: (response: unknown) => {
                const efforts = (response as Record<string, unknown>)?.efforts as Record<string, unknown> | undefined;
                return efforts ? Object.values(efforts) : [];
            },
        },
        {
            name: 'editeffort',
            display: '编辑工时记录',
            type: 'action',
            method: 'put',
            path: '/tasks/{effortID}/editeffort',
            resultType: 'text',
            minVersion: MIN_VERSION,
            pathParams: { effortID: '工时记录 ID' },
            params: [{ name: 'effortID', required: true, type: 'number', description: '工时记录 ID' }],
            requestBody: {
                required: true,
                type: 'object',
                schema: {
                    type: 'object',
                    properties: {
                        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
                        work: { type: 'string', description: '工作内容' },
                        consumed: { type: 'number', description: '本次耗时（小时，累加到总计）', format: 'float' },
                        left: { type: 'number', description: '更新后的剩余工时（小时，覆盖之前值）', format: 'float' },
                    },
                    required: ['consumed', 'left'],
                },
            },
        },
        {
            name: 'deleteeffort',
            display: '删除工时记录',
            type: 'delete',
            method: 'delete',
            path: '/tasks/{effortID}/deleteworkhour',
            resultType: 'text',
            minVersion: MIN_VERSION,
            pathParams: { effortID: '工时记录 ID' },
            params: [{ name: 'effortID', required: true, type: 'number', description: '工时记录 ID' }],
        },
    ]);
}

// ──────────────────────────── 3. Missing get actions ────────────────────────────

function addMissingGetActions(): void {
    const getActions: Array<{ module: string; display: string; idKey: string; resultGetter: string }> = [
        { module: 'build', display: '获取版本详情', idKey: 'buildID', resultGetter: 'build' },
        { module: 'release', display: '获取发布详情', idKey: 'releaseID', resultGetter: 'release' },
        { module: 'testtask', display: '获取测试单详情', idKey: 'testtaskID', resultGetter: 'testtask' },
    ];
    for (const def of getActions) {
        defineModuleActions(def.module, {
            name: 'get',
            display: def.display,
            type: 'get',
            method: 'get',
            path: `/${def.module}s/{${def.idKey}}`,
            resultType: 'object',
            resultGetter: def.resultGetter,
            minVersion: MIN_VERSION,
            pathParams: { [def.idKey]: `${def.module} ID` },
        });
    }
}

// ──────────────────────────── 4. Create/update schema completion ────────────────────────────

function completeCreateUpdateSchemas(): void {
    // bug create/update lack deadline and module, both of which ZenTao 22.5
    // validates on creation (deadline 必填, module 必填且不能为 0).
    for (const actionName of ['create', 'update']) {
        extendModuleAction('bug', actionName, (act) => {
            const schema = act.requestBody?.schema as
                | { properties?: Record<string, PropertyDef>; required?: string[] }
                | undefined;
            if (!schema) return act;
            schema.properties = {
                ...(schema.properties ?? {}),
                deadline: { type: 'string', description: '截止日期，格式 YYYY-MM-DD' },
                module: { type: 'number', description: '所属模块 ID' },
            };
            return act;
        });
    }

    // project create lacks desc, required by ZenTao on project creation.
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

    // story create lacks plan; ZenTao 22.1+ enforces a non-empty plan on some
    // editions (easysoft/zentao-cli#30). Web form semantics: plan is an array.
    extendModuleAction('story', 'create', (act) => {
        const schema = act.requestBody?.schema as
            | { properties?: Record<string, PropertyDef> }
            | undefined;
        if (!schema) return act;
        schema.properties = {
            ...(schema.properties ?? {}),
            plan: { type: 'array', items: { type: 'number' }, description: '所属计划 ID（可多个）' },
        };
        return act;
    });
}

// ──────────────────────────── 5. Action history & comments ────────────────────────────

/**
 * Object modules and their ID/path conventions.
 *
 * - `detailPath`: detail endpoint whose response embeds a top-level `actions`
 *   array (declared in ZenTao config/apiv2.php; live-verified for bug, story,
 *   task, testtask, release, productplan).
 * - `actionObjectType`: objectType value ZenTao stores in zt_action; used for
 *   the comment query param and the ajaxGetList fallback. epic/requirement are
 *   UR/SR stories, so their actions are stored with objectType `story`.
 */
const OBJECT_MODULES: Array<{
    module: string;
    display: string;
    idKey: string;
    actionObjectType: string;
    detailPath?: string;
}> = [
    { module: 'bug', display: 'Bug', idKey: 'bugID', actionObjectType: 'bug', detailPath: '/bugs/{bugID}' },
    { module: 'task', display: '任务', idKey: 'taskID', actionObjectType: 'task', detailPath: '/tasks/{taskID}' },
    { module: 'story', display: '需求', idKey: 'storyID', actionObjectType: 'story', detailPath: '/stories/{storyID}' },
    { module: 'epic', display: '业务需求', idKey: 'storyID', actionObjectType: 'story' },
    { module: 'requirement', display: '用户需求', idKey: 'storyID', actionObjectType: 'story' },
    { module: 'testcase', display: '用例', idKey: 'caseID', actionObjectType: 'testcase', detailPath: '/testcases/{caseID}' },
    { module: 'testtask', display: '测试单', idKey: 'testtaskID', actionObjectType: 'testtask', detailPath: '/testtasks/{testtaskID}' },
    { module: 'feedback', display: '反馈', idKey: 'feedbackID', actionObjectType: 'feedback', detailPath: '/feedbacks/{feedbackID}' },
    { module: 'ticket', display: '工单', idKey: 'ticketID', actionObjectType: 'ticket' },
    { module: 'product', display: '产品', idKey: 'productID', actionObjectType: 'product' },
    { module: 'project', display: '项目', idKey: 'projectID', actionObjectType: 'project' },
    { module: 'execution', display: '执行', idKey: 'executionID', actionObjectType: 'execution' },
    { module: 'build', display: '版本', idKey: 'buildID', actionObjectType: 'build', detailPath: '/builds/{buildID}' },
    { module: 'release', display: '发布', idKey: 'releaseID', actionObjectType: 'release', detailPath: '/releases/{releaseID}' },
    { module: 'productplan', display: '计划', idKey: 'planID', actionObjectType: 'productplan', detailPath: '/productplans/{planID}' },
    { module: 'program', display: '项目集', idKey: 'programID', actionObjectType: 'program' },
];

/**
 * ajaxGetList responses are ID-keyed maps plus a `status` key
 * ({'801665': {...}, '801666': {...}, status: 'success'}); convert to an array.
 */
function actionMapGetter(response: unknown): unknown[] {
    const { status: _status, ...records } = (response ?? {}) as Record<string, unknown>;
    return Object.values(records).filter((entry) => entry && typeof entry === 'object');
}

/** ZenTao-side objectType for a module's actions (epic/requirement store as story). */
export function actionObjectTypeFor(moduleName: string): string | undefined {
    return OBJECT_MODULES.find(def => def.module === moduleName)?.actionObjectType;
}

function addActionHistoryAndComments(): void {
    for (const def of OBJECT_MODULES) {
        const idKey = def.idKey;
        const pathParams = { [idKey]: `${def.display} ID` };

        // History read. Detail responses embed `actions`; modules without it
        // fall back to GET /action/ajaxGetList (reachable via action.comment).
        const historyAction: ModuleAction = def.detailPath
            ? {
                name: 'history',
                display: `获取${def.display}历史记录`,
                type: 'list',
                method: 'get',
                path: def.detailPath,
                resultType: 'list',
                resultGetter: 'actions',
                minVersion: MIN_VERSION,
                pathParams,
            }
            : {
                name: 'history',
                display: `获取${def.display}历史记录`,
                type: 'list',
                method: 'get',
                path: `/action/ajaxGetList?objectType=${def.actionObjectType}&objectID={${idKey}}`,
                resultType: 'list',
                resultGetter: actionMapGetter,
                minVersion: MIN_VERSION,
                pathParams,
            };
        defineModuleActions(def.module, historyAction);

        // Comment write via the 2-segment fallback route to action->comment.
        defineModuleActions(def.module, {
            name: 'comment',
            display: `添加${def.display}备注`,
            type: 'action',
            method: 'post',
            path: `/actions/comment?objectType=${def.actionObjectType}&objectID={${idKey}}`,
            resultType: 'text',
            minVersion: MIN_VERSION,
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

// ──────────────────────────── Entry ────────────────────────────

let applied = false;

/**
 * Register all registry extensions. Idempotent: defineModuleActions replaces
 * same-name actions, extendModuleAction deep-merges, so repeated application
 * is safe.
 */
export function applyRegistryExtensions(): void {
    if (applied) return;
    applied = true;
    addMissingWorkflowActions();
    addTaskEffortActions();
    addMissingGetActions();
    completeCreateUpdateSchemas();
    addActionHistoryAndComments();
}
