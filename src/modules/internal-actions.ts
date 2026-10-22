import { defineModuleActions, getModule } from 'zentao-api';
import type { ModuleAction, ModuleActionParam } from '../types/index.js';
import { downloadAttachment } from './internal-download.js';

type InternalAction = Omit<ModuleAction, 'minVersion'>;

// Retained internal definitions target community ZenTao 22.4. Do not infer
// support for other editions or replace actions supplied by a newer SDK.
function registerMissing(moduleName: string, definitions: InternalAction | InternalAction[]): void {
    for (const definition of Array.isArray(definitions) ? definitions : [definitions]) {
        const official = getModule(moduleName);
        if (!official) continue;
        if (official.actions.some(action => action.name === definition.name
            || (action.method?.toLowerCase() === definition.method?.toLowerCase()
                && action.path.replace(/\{[^}]+\}/g, '{}') === definition.path.replace(/\{[^}]+\}/g, '{}')))) continue;
        const pathKeys = Object.keys(definition.pathParams ?? {});
        const queryIDs = definition.params?.filter(param => pathKeys.includes(param.name)) ?? [];
        defineModuleActions(moduleName, {
            ...definition,
            minVersion: ['22.4'],
            ...(queryIDs.length ? {
                params: definition.params?.filter(param => !pathKeys.includes(param.name)),
                beforeRequest: async (request) => ({
                    query: {
                        ...request.query,
                        ...Object.fromEntries(queryIDs.map(param => [param.name, request.params[param.name] ?? request.id])),
                    },
                }),
            } : {}),
        });
    }
}

type PropertyDef = { type?: string; description?: string; format?: string };

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
): InternalAction {
    const pathParams: Record<string, string> = { [idKey]: `${moduleName} ID` };
    const result: InternalAction = {
        name,
        display,
        type: 'action',
        method: 'put',
        path: `/${moduleName === 'story' ? 'stories' : `${moduleName}s`}/{${idKey}}/${name}`,
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

const ASSIGN_FIELDS: Record<string, PropertyDef> = {
    assignedTo: { type: 'string', description: '指派给' },
    comment: { type: 'string', description: '备注' },
};

const COMMENT_FIELD: Record<string, PropertyDef> = {
    comment: { type: 'string', description: '备注' },
};

function addMissingDetailActions(): void {
    const getActions: Array<{ module: string; display: string; idKey: string; resultGetter: string }> = [
        { module: 'project', display: '获取项目详情', idKey: 'projectID', resultGetter: 'project' },
        { module: 'build', display: '获取版本详情', idKey: 'buildID', resultGetter: 'build' },
        { module: 'release', display: '获取发布详情', idKey: 'releaseID', resultGetter: 'release' },
        { module: 'system', display: '获取应用详情', idKey: 'systemID', resultGetter: 'system' },
        { module: 'testtask', display: '获取测试单详情', idKey: 'testtaskID', resultGetter: 'testtask' },
    ];

    for (const def of getActions) {
        const getAction: InternalAction = {
            name: 'get',
            display: def.display,
            type: 'get',
            method: 'get',
            path: `/${def.module}s/{${def.idKey}}`,
            resultType: 'object',
            resultGetter: def.resultGetter,
            pathParams: { [def.idKey]: `${def.module}ID` },
        };
        registerMissing(def.module, getAction);
    }
}

function addMissingWorkflowActions(): void {
    registerMissing('bug', [
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

    registerMissing('task', [
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
    registerMissing('story', storyLike('story', 'storyID', '需求'));
    registerMissing('epic', storyLike('epic', 'epicID', '业务需求'));
    registerMissing('requirement', storyLike('requirement', 'requirementID', '用户需求'));

    registerMissing('testcase', [
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

    registerMissing('testtask', [
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

    registerMissing('feedback', [
        action('feedback', 'assignto', '指派反馈', 'feedbackID', {
            properties: ASSIGN_FIELDS,
            required: ['assignedTo'],
        }),
    ]);

    registerMissing('ticket', [
        action('ticket', 'assignto', '指派工单', 'ticketID', {
            properties: ASSIGN_FIELDS,
            required: ['assignedTo'],
        }),
    ]);

    registerMissing('task', {
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
                    date: { type: 'array', items: { type: 'string' }, description: '日期，格式 YYYY-MM-DD，默认今天' },
                    work: { type: 'array', items: { type: 'string' }, description: '工作内容' },
                    consumed: { type: 'array', items: { type: 'number' }, description: '本次耗时（小时，累加到总计）' },
                    left: { type: 'array', items: { type: 'number' }, description: '更新后的剩余工时（小时，覆盖之前值）' },
                },
                required: ['date', 'consumed', 'left'],
            },
        },
    });

    registerMissing('task', {
        name: 'effort',
        display: '获取任务工时记录',
        type: 'list',
        method: 'get',
        path: '/tasks/{taskID}/recordworkhour',
        resultType: 'list',
        resultGetter: (response: unknown) => {
            const r = response as Record<string, unknown>;
            const efforts = r?.efforts as Record<string, unknown> | undefined;
            return efforts ? Object.values(efforts) : [];
        },
        pathParams: { taskID: '任务 ID' },
        params: [
            { name: 'taskID', required: true, type: 'number', description: '任务 ID' },
        ],
    });

    registerMissing('task', {
        name: 'editeffort',
        display: '编辑工时记录',
        type: 'action',
        method: 'put',
        path: '/tasks/{effortID}/editeffort',
        resultType: 'text',
        pathParams: { effortID: '工时记录 ID' },
        params: [
            { name: 'effortID', required: true, type: 'number', description: '工时记录 ID' },
        ],
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
    });

    registerMissing('task', {
        name: 'deleteeffort',
        display: '删除工时记录',
        type: 'delete',
        method: 'delete',
        path: '/tasks/{effortID}/deleteworkhour',
        resultType: 'text',
        pathParams: { effortID: '工时记录 ID' },
        params: [
            { name: 'effortID', required: true, type: 'number', description: '工时记录 ID' },
        ],
    });

}

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

function addActionHistoryAndComments(): void {
    for (const { module, objectType, idKey, display } of HISTORY_MODULES) {
        const pathParams: Record<string, string> = { [idKey]: `${display} ID` };

        registerMissing(module, {
            name: 'history',
            display: `获取${display}历史记录`,
            type: 'list',
            method: 'get',
            path: `/actions/${objectType}/{${idKey}}`,
            resultType: 'list',
            resultGetter: 'actions',
            pathParams,
        });

        registerMissing(module, {
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


export function registerInternalActions(): void {
    addMissingDetailActions();
    addMissingWorkflowActions();
    addActionHistoryAndComments();
    registerMissing('file', {
        name: 'download', display: '下载附件到本地目录', type: 'action',
        method: 'get', path: '/files/{fileID}/download', resultType: 'object',
        resultGetter: 'data', pathParams: { fileID: '附件 ID' },
        params: [{ name: 'output', type: 'string', description: '本地输出目录，默认当前目录' }],
        request: downloadAttachment,
    });
}
