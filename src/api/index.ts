import { ZentaoClient, type ActionAssistant, type ClientRequestOptions } from 'zentao-api';
import { resolveAssistant } from './assistant.js';
import { mapSdkError, ZentaoError } from '../errors.js';
import { assertAuthenticatedPayload, assertAuthenticatedResponse } from '../auth/response.js';
import type { ServerConfig } from '../types/index.js';

export { ZentaoClient };

/** CLI client guard for ZenTao installations that return a login page with HTTP 200. */
class ValidatingZentaoClient extends ZentaoClient {
    override request(path: string, options: ClientRequestOptions & { responseType: 'response' }): Promise<Response>;
    override request(path: string, options: ClientRequestOptions & { responseType: 'arrayBuffer' }): Promise<ArrayBuffer>;
    override request(path: string, options: ClientRequestOptions & { responseType: 'blob' }): Promise<Blob>;
    override request<T = unknown>(path: string, options?: ClientRequestOptions): Promise<T>;
    override async request<T = unknown>(path: string, options?: ClientRequestOptions): Promise<T> {
        const payload = await super.request<T>(path, options);
        if (payload instanceof Response) {
            await assertAuthenticatedResponse(payload);
        } else {
            assertAuthenticatedPayload(payload);
        }
        return payload;
    }
}

/** 创建 {@link ZentaoClient} 时的可选行为（TLS、超时等） */
export interface ClientOptions {
    /** Runtime-only operation attribution; an empty string disables the header. */
    actionAssistant?: ActionAssistant;
    /** 为 true 时跳过 TLS 证书校验（仅 Node.js 运行时支持） */
    insecure?: boolean;
    /** 默认请求超时（毫秒） */
    timeout?: number;
}

/**
 * 以旧版 `(serverUrl, token, options)` 的位置参数语义创建 SDK 客户端。
 * 内部映射到 `zentao-api` 的对象参数构造器，便于沿用 CLI 既有调用点。
 */
export function createClient(serverUrl: string, token?: string, options?: ClientOptions): ZentaoClient {
    return new ValidatingZentaoClient({
        baseUrl: serverUrl,
        token,
        insecure: options?.insecure,
        timeout: options?.timeout,
        actionAssistant: options?.actionAssistant ?? resolveAssistant(),
    });
}

/** Bind cancellation to one SDK call without changing a shared client's state. */
export function withRequestSignal(client: ZentaoClient, signal?: AbortSignal): ZentaoClient {
    if (!signal) return client;
    const scoped = new ZentaoClient(client.siteUrl);
    const optionsWithSignal = <T extends object>(options: T): T & { signal: AbortSignal } => {
        const selected = ('signal' in options ? options.signal as AbortSignal | undefined : undefined) ?? signal;
        if (selected.aborted) throw new ZentaoError('E5003');
        return { ...options, signal: selected };
    };
    // SDK 0.7 high-level requests omit signal; its public transport accepts it.
    // Forwarding preserves credentials, transport options and the config cache.
    scoped.request = ((path: string, options = {}) => client.request(path, optionsWithSignal(options))) as ZentaoClient['request'];
    scoped.fetch = (url, options, token, fetchOptions) => client.fetch(url, optionsWithSignal(options), token, fetchOptions);
    scoped.getZentaoConfig = (options = {}) => client.getZentaoConfig(optionsWithSignal(options));
    return scoped;
}

/**
 * 获取禅道服务端配置。
 *
 * Reuse the SDK's token-free config request and 24-hour in-memory cache.
 */
export async function getServerConfig(client: ZentaoClient): Promise<ServerConfig> {
    try {
        return await client.getZentaoConfig();
    } catch (error) {
        throw mapSdkError(error);
    }
}
