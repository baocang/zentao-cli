import { ZentaoError } from '../errors.js';
import type { ModuleActionOptions } from '../types/index.js';

const ACTION_NAME_ALIASES: Record<string, string> = {
    ls: 'list',
};

/** 将 actionName 归一化（如 `ls` → `list`） */
export function normalizeActionName(actionName: string): string {
    return ACTION_NAME_ALIASES[actionName] ?? actionName;
}

/** 将 CLI 字符串值做基础类型转换 */
function coerceValue(raw: string): unknown {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^-?\d+$/.test(raw)) return Number(raw);
    if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
    return raw;
}

/**
 * 将一个 flag 值写入 params。当同一 key 重复出现时，累积为逗号分隔字符串，
 * 以兼容禅道多值字段（如 reviewer / openedBuild / mailto）的约定格式。
 */
function assignFlag(params: Record<string, unknown>, key: string, value: unknown): void {
    const existing = params[key];
    if (existing === undefined || existing === true) {
        params[key] = value;
    } else {
        params[key] = `${existing},${value}`;
    }
}

/**
 * 将 CLI 选项与位置参数组装成 SDK `request()` 可消费的参数对象。
 *
 * 负责 CLI 专属的 argv 解析：
 * - 位置参数中的对象 ID（支持逗号分隔的批量 ID 由上层先行拆分）
 * - 位置参数中的 `{...}` JSON 作为请求体（写入 `params.data`）
 * - `--key=value` 形式的额外参数（带基础类型转换）
 * - `--params` 指定的 JSON 对象（浅合并到 params）
 *
 * 路径、查询、请求体的最终拼装由 SDK 的 `resolveModuleCommand` 完成。
 */
export function buildParams(
    options: ModuleActionOptions,
    actionName: string,
    args?: string[],
): Record<string, unknown> {
    const params: Record<string, unknown> = { ...options };

    const extraArgs = args ? [...args] : [];
    if (extraArgs.length > 0 && extraArgs[0] === actionName) {
        extraArgs.shift();
    }

    let positionalID: string | undefined;
    if (extraArgs.length > 0 && !extraArgs[0].startsWith('-')) {
        const candidate = extraArgs[0].trim();
        // 兼容 ZenTao 22.x 部分模块（如 testcase）返回的带前缀复合 ID（如 `case_48`）：
        // 剥离纯字母前缀后再做数字判定，使 `zentao testcase case_48` 也能识别为位置 ID。
        const idParts = candidate
            .split(',')
            .map((part) => part.trim().replace(/^[a-zA-Z]+_(\d+)$/, '$1'))
            .filter(Boolean);
        const isNumericID = idParts.length > 0 && idParts.every((part) => /^\d+$/.test(part));
        if (isNumericID) {
            positionalID = idParts.join(',');
            extraArgs.shift();
        } else if (params.data === undefined && candidate.startsWith('{') && candidate.endsWith('}')) {
            params.data = candidate;
            extraArgs.shift();
        }
    }

    if (options.params) {
        try {
            Object.assign(params, JSON.parse(options.params));
        } catch {
            throw new ZentaoError('E2009', { option: 'params', reason: '不是有效的 JSON 对象' });
        }
    }

    for (let i = 0; i < extraArgs.length; i++) {
        const arg = extraArgs[i];
        // --key=value 形式
        const match = arg.match(/^--(\w[\w.-]*)=(.*)$/);
        if (match) {
            assignFlag(params, match[1], coerceValue(match[2]));
            continue;
        }
        // --key value 形式（空格分隔，Commander 未注册的选项会落入 args）
        const flagMatch = arg.match(/^--(\w[\w.-]*)$/);
        if (flagMatch) {
            if (i + 1 < extraArgs.length && !extraArgs[i + 1].startsWith('--')) {
                assignFlag(params, flagMatch[1], coerceValue(extraArgs[i + 1]));
                i++;
            } else {
                // 无后续值的裸 flag（末尾或紧随另一个 --flag），视为布尔 true
                assignFlag(params, flagMatch[1], true);
            }
        }
    }

    if (positionalID !== undefined) {
        params.id = positionalID;
    }

    // ZenTao 22.x 在部分模块（如 testcase）列表中返回带前缀的复合 ID
    //（形如 `case_48`），但其详情/操作接口仅接受纯数字。无论 id 来自位置参数
    // 还是 `get <module> <id>` 的 Commander 位置参数，统一剥离纯字母前缀，
    // 使 `get testcase case_48` 与 `get testcase 48` 等价。
    if (typeof params.id === 'string' && params.id.length > 0) {
        const normalizedId = params.id
            .split(',')
            .map((part) => part.trim().replace(/^[a-zA-Z]+_(\d+)$/, '$1'))
            .filter(Boolean)
            .join(',');
        if (normalizedId) params.id = normalizedId;
    }

    return params;
}
