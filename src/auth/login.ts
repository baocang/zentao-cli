import { brandText } from '../brand.js';
import { findCurrentUser, supportsCurrentUserProfile } from './user.js';
import { ZentaoClient, createClient, getServerConfig, type ClientOptions } from '../api/index.js';
import type { ServerConfig } from '../types/index.js';
import { ZentaoError, mapSdkError } from '../errors.js';
import { readFileSync, statSync } from 'node:fs';

/** 密码登录成功后的结果 */
export interface LoginResult {
    client: ZentaoClient;
    token: string;
    user?: Record<string, unknown>;
    serverConfig?: ServerConfig;
}

/** 从环境变量读取的凭证片段（任一字段可能缺失） */
export interface EnvCredentials {
    url?: string;
    account?: string;
    password?: string;
    token?: string;
}

/** Authenticate with a password and retrieve the current user's profile. */
export async function login(
    serverUrl: string,
    account: string,
    password: string,
    options?: ClientOptions & { signal?: AbortSignal },
): Promise<LoginResult> {
    const client = createClient(serverUrl, undefined, options);
    const originalFetch = client.fetch;
    if (options?.signal) {
        // This client belongs to this login attempt; cover every SDK request, including config loading.
        client.fetch = (url, request, token, fetchOptions) => {
            if (options.signal?.aborted) throw new ZentaoError('E5003');
            return originalFetch.call(client, url, { ...request, signal: options.signal }, token, fetchOptions);
        };
    }

    try {
        let token: string;
        try {
            token = await client.login(account, password);
        } catch (error) {
            throw mapSdkError(error);
        }

        let user: Record<string, unknown> | undefined;
        const serverConfig = await getServerConfig(client);
        try {
            ({ user } = await findCurrentUser(client, account));
        } catch (error) {
            // Legacy deployments may restrict directory access even after a successful login.
            if (supportsCurrentUserProfile(serverConfig.version)) throw mapSdkError(error);
        }

        if (options?.signal?.aborted) throw new ZentaoError('E5003');
        return { client, token, user, serverConfig };
    } finally {
        client.fetch = originalFetch;
    }
}

/** Verify the token owner's identity, or look up the provided account on legacy servers. */
export async function verifyToken(
    client: ZentaoClient,
    account: string,
): Promise<{ serverConfig: ServerConfig; user?: Record<string, unknown> }> {
    try {
        const serverConfig = await getServerConfig(client);
        const { user, hadUsers } = await findCurrentUser(client, account);
        if (!hadUsers) throw new ZentaoError('E1004');
        return { serverConfig, user };
    } catch (error) {
        throw mapSdkError(error);
    }
}

/**
 * 读取 `ZENTAO_URL` / `ZENTAO_ACCOUNT` / `ZENTAO_PASSWORD` / `ZENTAO_TOKEN`。
 *
 * 支持凭据文件（无人值守自动化场景）：设置 `ZENTAO_CREDENTIALS_FILE` 指向一个
 * 0600 权限的 KEY=VALUE 文件，可包含上述四个变量；文件值只填补未在真实
 * 环境变量中出现的字段，真实环境变量优先。文件权限过宽直接报错。
 */
export function getEnvCredentials(): EnvCredentials {
    const direct: EnvCredentials = {
        url: process.env[brandText('ZENTAO_URL')],
        account: process.env[brandText('ZENTAO_ACCOUNT')],
        password: process.env[brandText('ZENTAO_PASSWORD')],
        token: process.env[brandText('ZENTAO_TOKEN')],
    };
    const credentialsFile = process.env[brandText('ZENTAO_CREDENTIALS_FILE')];
    if (!credentialsFile?.trim()) return direct;
    let parsed: Record<string, string> = {};
    try {
        const mode = statSync(credentialsFile).mode & 0o777;
        if (mode & 0o177) {
            throw new ZentaoError('E2009', {
                option: 'ZENTAO_CREDENTIALS_FILE',
                reason: `凭据文件权限过宽 (${mode.toString(8)})，仅允许属主读写，请执行 chmod 600 ${credentialsFile}`,
            });
        }
        parsed = Object.fromEntries(
            readFileSync(credentialsFile, 'utf8')
                .split(/\r?\n/)
                .map(line => line.match(/^\s*(ZENTAO_(?:URL|ACCOUNT|PASSWORD|TOKEN))=(.*)\s*$/))
                .filter((match): match is RegExpMatchArray => match !== null)
                .map(match => [match[1], match[2]]),
        );
    } catch (error) {
        if (error instanceof ZentaoError) throw error;
        throw new ZentaoError('E2009', {
            option: 'ZENTAO_CREDENTIALS_FILE',
            reason: `无法读取凭据文件: ${credentialsFile}`,
        }, error instanceof Error ? error.message : error);
    }
    return {
        url: direct.url ?? parsed.ZENTAO_URL,
        account: direct.account ?? parsed.ZENTAO_ACCOUNT,
        password: direct.password ?? parsed.ZENTAO_PASSWORD,
        token: direct.token ?? parsed.ZENTAO_TOKEN,
    };
}
