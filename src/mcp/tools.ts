import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getAllModules } from '../modules/helper.js';
import type { ModuleDefinition, ModuleAction, ModuleActionOptions } from '../types/index.js';
import { executeModuleCommand } from '../modules/executor.js';
import { ZentaoError } from '../errors.js';
import type { AuthProvider } from './server.js';
import { getCurrentProfile, getProfileConfig, setCurrentProfile, profileKey } from '../config/store.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { tryReauth } from '../auth/flow.js';
import { uploadFileAttachment } from '../commands/module-handler.js';

function buildToolDescription(mod: ModuleDefinition): string {
    const actions = mod.actions.map(a => a.name);
    const parts: string[] = [];
    if (mod.description) {
        parts.push(mod.description);
    } else {
        parts.push(`${mod.display ?? mod.name} 管理`);
    }
    parts.push(`支持操作: ${actions.join(', ')}`);

    const listAction = mod.actions.find(a => a.type === 'list');
    if (listAction?.pathParams && 'scope' in listAction.pathParams) {
        const scopeDef = listAction.pathParams.scope;
        if (typeof scopeDef === 'object' && scopeDef.options) {
            const scopes = scopeDef.options.map((o: { value: unknown; label: string }) =>
                `--${String(o.value).replace(/s$/, '')}`
            );
            parts.push(`列表范围参数: ${scopes.join(', ')}`);
        } else {
            parts.push('列表范围参数: --product, --project, --execution');
        }
    }

    return parts.join('。');
}

function buildActionEnum(mod: ModuleDefinition): [string, ...string[]] {
    const names = mod.actions.map(a => a.name);
    return [names[0], ...names.slice(1)];
}

function buildInputSchema(mod: ModuleDefinition): Record<string, any> {
    const actionEnum = buildActionEnum(mod);
    return {
        action: z.enum(actionEnum).describe('要执行的操作。' + mod.actions.map(a =>
            `${a.name}: ${a.display ?? a.name}`
        ).join('; ')),
        id: z.number().optional().describe('对象 ID（get/update/delete 及扩展操作必填）'),
        ids: z.array(z.number()).optional().describe('批量操作的对象 ID 列表（用于批量 get/update/delete 等）'),
        product: z.number().optional().describe('产品 ID（范围参数）'),
        project: z.number().optional().describe('项目 ID（范围参数）'),
        execution: z.number().optional().describe('执行 ID（范围参数）'),
        params: z.record(z.string(), z.unknown()).optional().describe('API 参数键值对，用于传递操作所需字段（如 title, severity 等）'),
        pick: z.string().optional().describe('摘取字段（逗号分隔）'),
        filter: z.array(z.string()).optional().describe('过滤条件（如 status:active, severity<=2）'),
        sort: z.string().optional().describe('排序（如 pri_asc, severity_desc）'),
        search: z.array(z.string()).optional().describe('搜索关键词'),
        searchFields: z.string().optional().describe('搜索字段（逗号分隔），配合 search 使用'),
        page: z.number().optional().describe('页码'),
        recPerPage: z.number().optional().describe('每页条数'),
        all: z.boolean().optional().describe('获取全部数据（自动翻页）'),
        limit: z.number().optional().describe('限制返回数量'),
    };
}

interface ToolInput {
    action: string;
    id?: number;
    ids?: number[];
    product?: number;
    project?: number;
    execution?: number;
    params?: Record<string, unknown>;
    pick?: string;
    filter?: string[];
    sort?: string;
    search?: string[];
    searchFields?: string;
    page?: number;
    recPerPage?: number;
    all?: boolean;
    limit?: number;
}

async function handleProfileTool(auth: AuthProvider): Promise<CallToolResult> {
    const client = await auth.getClient();
    const profile = getCurrentProfile();
    const account = profile?.account;

    const usersResp = await client.get<Record<string, unknown>>('/users', {
        query: { browseType: 'inside', recPerPage: 100 },
    });

    const usersRaw = (usersResp as Record<string, unknown>).users;
    const users = Array.isArray(usersRaw) ? usersRaw as Array<Record<string, unknown>> : [];
    const user = account
        ? users.find((item) => String(item.account ?? '') === account)
        : undefined;

    return {
        content: [{
            type: 'text',
            text: JSON.stringify(user ?? profile?.user ?? {}, null, 2),
        }],
    };
}

interface SwitchProfileInput {
    profileKey: string;
}

async function handleSwitchProfileTool(input: SwitchProfileInput, auth: AuthProvider): Promise<CallToolResult> {
    const success = setCurrentProfile(input.profileKey);
    if (!success) {
        throw new ZentaoError('E1007');
    }

    auth.resetClient();
    await auth.getClient();

    const current = getCurrentProfile();
    const currentKey = current ? profileKey(current.account, current.server) : input.profileKey;
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                status: 'success',
                currentProfile: currentKey,
            }, null, 2),
        }],
    };
}

async function handleModuleTool(
    mod: ModuleDefinition,
    input: ToolInput,
    auth: AuthProvider,
): Promise<CallToolResult> {
    const client = await auth.getClient();
    const profile = getCurrentProfile();
    const config = profile ? getProfileConfig(profile) : DEFAULT_CONFIG;
    const actionName = input.action;

    const baseOpts: ModuleActionOptions = {
        id: input.id != null ? String(input.id) : undefined,
        product: input.product != null ? String(input.product) : undefined,
        project: input.project != null ? String(input.project) : undefined,
        execution: input.execution != null ? String(input.execution) : undefined,
        params: input.params ? JSON.stringify(input.params) : undefined,
        pick: input.pick,
        filter: input.filter,
        sort: input.sort,
        search: input.search,
        searchFields: input.searchFields,
        page: input.page != null ? String(input.page) : undefined,
        recPerPage: input.recPerPage != null ? String(input.recPerPage) : undefined,
        all: input.all,
        limit: input.limit != null ? String(input.limit) : undefined,
        format: 'json',
        yes: true,
    };

    // File upload requires multipart FormData — bypass normal JSON execution.
    // Agent passes params: { file: '/local/path', objectType?: 'bug', objectID?: 972 }.
    if (mod.name === 'file' && actionName === 'upload') {
        const p = input.params ?? {};
        const filePath = typeof p.file === 'string' ? p.file : undefined;
        if (!filePath) {
            throw new ZentaoError('E2009', { option: 'file', reason: '上传附件必须在 params 中提供本地文件路径（file 字段）' });
        }
        const objectType = p.objectType != null ? String(p.objectType) : undefined;
        const objectID = p.objectID != null ? String(p.objectID) : undefined;
        if (!profile) throw new ZentaoError('E1006');
        const result = await uploadFileAttachment(client, profile, filePath, objectType, objectID);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', data: result.response }, null, 2) }] };
    }

    // Batch mode: iterate over ids array
    if (input.ids && input.ids.length > 0) {
        const results: Array<Record<string, unknown>> = [];
        const errors: Array<Record<string, unknown>> = [];
        let reauthAttempted = false;
        for (const id of input.ids) {
            try {
                const exec = await executeModuleCommand(client, mod, actionName, [], { ...baseOpts, id: String(id) }, config);
                results.push({ id, data: exec.data });
            } catch (error) {
                if (error instanceof ZentaoError && error.code === '1004' && !reauthAttempted && profile) {
                    reauthAttempted = true;
                    const reauthed = await tryReauth(client, profile);
                    if (reauthed) {
                        try {
                            const exec = await executeModuleCommand(client, mod, actionName, [], { ...baseOpts, id: String(id) }, config);
                            results.push({ id, data: exec.data });
                            continue;
                        } catch (retryError) {
                            errors.push({ id, error: retryError instanceof Error ? retryError.message : String(retryError) });
                            continue;
                        }
                    }
                }
                errors.push({ id, error: error instanceof Error ? error.message : String(error) });
            }
        }
        const response: Record<string, unknown> = { results };
        if (errors.length > 0) response.errors = errors;
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }

    let execution;
    try {
        execution = await executeModuleCommand(client, mod, actionName, [], baseOpts, config);
    } catch (error) {
        if (error instanceof ZentaoError && error.code === '1004' && profile) {
            const reauthed = await tryReauth(client, profile);
            if (reauthed) {
                execution = await executeModuleCommand(client, mod, actionName, [], baseOpts, config);
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    }

    if (execution.action.type === 'list') {
        const response: Record<string, unknown> = { data: execution.data };
        if (execution.pager) response.pager = execution.pager;
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }

    if (execution.action.type === 'get') {
        return { content: [{ type: 'text', text: JSON.stringify(execution.data, null, 2) }] };
    }

    // create / update / delete / action
    return { content: [{ type: 'text', text: JSON.stringify(execution.data ?? execution.rawResponse, null, 2) }] };
}

function toolAnnotations(actions: readonly ModuleAction[]) {
    const readOnly = actions.every(action => action.type === 'list' || action.type === 'get');
    const destructive = actions.some(action => action.type === 'delete');
    return {
        readOnlyHint: readOnly,
        destructiveHint: destructive,
        openWorldHint: true,
    };
}

export function registerModuleTools(server: McpServer, auth: AuthProvider): void {
    server.tool(
        'zentao_profile',
        '获取当前登录禅道账号信息',
        {},
        { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
        async () => {
            try {
                return await handleProfileTool(auth);
            } catch (error) {
                if (error instanceof ZentaoError) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `E${error.code}: ${error.message}` }],
                    };
                }
                return {
                    isError: true,
                    content: [{ type: 'text', text: (error as Error).message ?? String(error) }],
                };
            }
        },
    );

    server.tool(
        'zentao_switch_profile',
        '切换当前登录账号（等价于 switch-profile）',
        {
            profileKey: z.string().describe('目标用户配置标识，支持 account@server、account 或 account@hostname'),
        } as Record<string, any>,
        { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        async (input) => {
            try {
                return await handleSwitchProfileTool(input as SwitchProfileInput, auth);
            } catch (error) {
                if (error instanceof ZentaoError) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `E${error.code}: ${error.message}` }],
                    };
                }
                return {
                    isError: true,
                    content: [{ type: 'text', text: (error as Error).message ?? String(error) }],
                };
            }
        },
    );

    for (const mod of getAllModules()) {
        const name = `zentao_${mod.name}`;
        const description = buildToolDescription(mod);
        const inputSchema = buildInputSchema(mod);

        const annotations = toolAnnotations(mod.actions);

        server.tool(name, description, inputSchema, annotations, async (input) => {
            try {
                return await handleModuleTool(mod, input as ToolInput, auth);
            } catch (error) {
                if (error instanceof ZentaoError) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `E${error.code}: ${error.message}` }],
                    };
                }
                return {
                    isError: true,
                    content: [{ type: 'text', text: (error as Error).message ?? String(error) }],
                };
            }
        });
    }
}
