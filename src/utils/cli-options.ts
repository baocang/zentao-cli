import type { ModuleActionOptions } from '../types/index.js';

/**
 * 解析 `--options` JSON 字符串并合并到选项对象。
 *
 * `--options '{"format":"json","limit":5}'` 提供一种以 JSON 对象替代逐个公共选项的快捷传参方式。
 * 合并优先级：显式 CLI 标志（非 undefined 值）> `--options` JSON 值。
 */
export function applyOptionsJson(options: ModuleActionOptions): ModuleActionOptions {
    const raw = (options as Record<string, unknown>).options;
    if (!raw || typeof raw !== 'string') return options;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return options;
        const merged: Record<string, unknown> = { ...parsed };
        for (const [key, value] of Object.entries(options)) {
            if (value !== undefined) merged[key] = value;
        }
        delete merged.options;
        return merged as ModuleActionOptions;
    } catch {
        return options;
    }
}
