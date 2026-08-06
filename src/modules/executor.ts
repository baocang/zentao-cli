import { request } from 'zentao-api';
import type { ZentaoClient } from '../api/index.js';
import { mapSdkError } from '../errors.js';
import type {
    ListPagerInfo,
    ModuleAction,
    ModuleActionName,
    ModuleActionOptions,
    ModuleDefinition,
    UserConfig,
} from '../types/index.js';
import { filterData, pickFields, pickFieldsSingle, searchData, sortData } from '../utils/data.js';
import { convertHtmlFields, convertHtmlFieldsInArray } from '../utils/html.js';
import { buildParams, normalizeActionName } from './args.js';
import { getAction } from './helper.js';
import { ZentaoError } from '../errors.js';

export interface ModuleExecutionResult {
    /** 解析到的动作定义 */
    action: ModuleAction;
    /** 经提取与本地后处理后的业务数据 */
    data: unknown;
    /** SDK 归一化后的完整响应（供 `--format raw` 使用） */
    rawResponse: unknown;
    /** 分页信息（CLI 字段命名） */
    pager?: ListPagerInfo;
    /** 用户通过 --pick 指定的字段 */
    fields?: string[];
    /** 是否为列表结果 */
    isList: boolean;
}

function parseFields(fields?: string): string[] | undefined {
    const parsed = fields?.split(',').map((field) => field.trim()).filter(Boolean);
    return parsed && parsed.length > 0 ? parsed : undefined;
}

/**
 * 将 `action.params` 声明的查询参数同步到顶层 `params`。
 *
 * 部分禅道接口要求上下文 ID 以查询参数形式传递，但用户可能通过以下方式传入：
 * 1. `--data '{"productID":1,…}'`：整体 JSON 中包含查询字段
 * 2. 位置 ID（`zentao testcase review 1`）：当查询参数名与路径参数名一致时
 *    （如 caseID），把已解析的 `params.id` 提升为查询参数。
 */
function syncQueryParams(
    params: Record<string, unknown>,
    action: ModuleAction,
): void {
    const queryFields = action.params;
    if (!queryFields?.length) return;

    let dataRecord: Record<string, unknown> | undefined;
    if (params.data !== undefined) {
        let data: unknown = params.data;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch {
                data = undefined;
            }
        }
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            dataRecord = data as Record<string, unknown>;
        }
    }

    const pathParamNames = new Set(Object.keys(action.pathParams ?? {}));

    for (const field of queryFields) {
        if (params[field.name] !== undefined) continue;
        if (dataRecord && dataRecord[field.name] !== undefined) {
            params[field.name] = dataRecord[field.name];
            continue;
        }
        if (pathParamNames.has(field.name) && params.id !== undefined) {
            params[field.name] = params.id;
        }
    }
}

/**
 * 将短名上下文参数（product / project / execution）映射到路径占位符所需的全名形式
 *（productID / projectID / executionID）。
 *
 * 作用域（scope）列表接口（如 story、bug）由 SDK 的 `pickScope` 自动处理短名；
 * 但显式路径接口（如 `GET /products/{productID}/releases`）只认 `productID`，
 * 此函数补齐短名 → 全名的映射，使 `--product=1` 在两种接口中都能使用。
 */
function syncContextParams(
    params: Record<string, unknown>,
    action: ModuleAction,
): void {
    const pathParamNames = action.pathParams ? Object.keys(action.pathParams) : [];
    const map: Array<[string, string]> = [
        ['product', 'productID'],
        ['project', 'projectID'],
        ['execution', 'executionID'],
    ];
    for (const [shortName, fullName] of map) {
        if (pathParamNames.includes(fullName) && params[fullName] === undefined && params[shortName] !== undefined) {
            params[fullName] = params[shortName];
        }
    }
}

/**
 * 执行模块级 CRUD 或扩展操作。
 *
 * 路径解析、查询/请求体组装、update 自动补全（autoFill）与响应提取均交由
 * `zentao-api` 的 {@link request} 处理；CLI 侧仅保留 HTML→Markdown 转换与
 * 客户端过滤/搜索/排序/限制/摘取（语义与既有用法保持一致）。
 */
export async function executeModuleCommand(
    client: ZentaoClient,
    module: ModuleDefinition,
    actionName: ModuleActionName,
    args: string[],
    options: ModuleActionOptions,
    config: UserConfig,
): Promise<ModuleExecutionResult> {
    const action = getAction(module, actionName);
    if (!action) {
        throw new ZentaoError('E2005', { module: module.name });
    }

    const params = buildParams(options, actionName, args);
    syncQueryParams(params, action);
    syncContextParams(params, action);
    // 列表操作将 --sort 转发为服务端 orderBy，使排序在服务端生效（而非仅客户端当页排序）
    if (action.type === 'list' && options.sort) {
        params.orderBy = options.sort;
    }
    const requestName = `${module.name}/${normalizeActionName(actionName)}`;

    const requestOptions = {
        client,
        autoFill: action.type === 'update',
        throwOnFail: true,
        recPerPage: options.recPerPage,
        timeout: options.timeout,
        insecure: options.insecure,
    };

    let response;
    try {
        response = await request(requestName, params, requestOptions);
    } catch (error) {
        throw mapSdkError(error);
    }

    // --all：列表操作自动翻页拉取全部数据
    if (action.type === 'list' && options.all && response.pager && response.pager.total > response.pager.recPerPage) {
        const pageSize = response.pager.recPerPage;
        const totalPages = Math.ceil(response.pager.total / pageSize);
        let allData = (Array.isArray(response.data) ? response.data : []) as unknown[];
        for (let page = 2; page <= totalPages; page++) {
            try {
                const pageResp = await request(requestName, { ...params, recPerPage: pageSize, pageID: page }, requestOptions);
                allData = allData.concat(Array.isArray(pageResp.data) ? pageResp.data : []);
            } catch {
                break;
            }
        }
        response = {
            ...response,
            data: allData,
            pager: { total: response.pager.total, page: 1, recPerPage: response.pager.total },
        };
    }

    const fields = parseFields(options.pick);
    const pager: ListPagerInfo | undefined = response.pager
        ? {
            pageID: response.pager.page,
            recPerPage: response.pager.recPerPage,
            recTotal: response.pager.total,
        }
        : undefined;

    if (action.type === 'list') {
        let data = (Array.isArray(response.data) ? response.data : []) as Record<string, unknown>[];

        if (config.htmlToMarkdown !== false) {
            data = convertHtmlFieldsInArray(data);
        }
        if (options.filter?.length) {
            data = filterData(data, options.filter);
        }
        if (options.search?.length) {
            data = searchData(data, options.search, options.searchFields?.split(','));
        }
        if (options.sort) {
            data = sortData(data, options.sort);
        }
        if (options.limit && Number(options.limit) < data.length) {
            data = data.slice(0, Number(options.limit));
        }
        if (fields) {
            data = pickFields(data, fields);
        }

        return { action, data, rawResponse: response, pager, fields, isList: true };
    }

    if (action.type === 'get') {
        let data = (response.data ?? {}) as Record<string, unknown>;
        if (config.htmlToMarkdown !== false) {
            data = convertHtmlFields(data);
        }
        if (fields) {
            data = pickFieldsSingle(data, fields);
        }

        return { action, data, rawResponse: response, fields, isList: false };
    }

    return { action, data: response.data, rawResponse: response, fields, isList: false };
}
