import type { Profile } from '../types/index.js';
import { ZentaoClient, createClient } from '../api/index.js';
import { ZentaoError } from '../errors.js';
import { getCurrentProfile, getProfile, saveProfile, getProfileConfig, buildProfile } from '../config/store.js';
import { login, getEnvCredentials } from './login.js';

/** 已通过鉴权后的运行时上下文，供命令层发起 API 调用 */
export interface AuthContext {
    client: ZentaoClient;
    profile: Profile;
}

/**
 * 确保当前进程具备可用的禅道凭证。
 *
 * 解析顺序：
 * 1. 读取本地 `currentProfile`，若 Token 可用则直接复用并刷新 `lastUsedTime`
 * 2. 否则读取 `ZENTAO_*` 环境变量：优先 Token 校验，其次账号密码登录
 * 3. 均失败时抛出 {@link ZentaoError} `E1006`
 */
export async function ensureAuth(options?: { insecure?: boolean; timeout?: number }): Promise<AuthContext> {
    const currentProfile = getCurrentProfile();
    if (currentProfile?.token) {
        const config = getProfileConfig(currentProfile);
        const clientOpts = {
            insecure: options?.insecure ?? config.insecure,
            timeout: options?.timeout ?? config.timeout,
        };
        currentProfile.lastUsedTime = new Date().toISOString();
        saveProfile(currentProfile);
        return {
            client: createClient(currentProfile.server, currentProfile.token, clientOpts),
            profile: currentProfile,
        };
    }

    const env = getEnvCredentials();
    if (env.url && env.account && (!currentProfile || (currentProfile.account === env.account && currentProfile.server === env.url))) {
        if (env.token) {
            const clientOpts = { insecure: options?.insecure, timeout: options?.timeout };
            const normalizedServer = env.url.replace(/\/+$/, '');
            const existingProfile = getProfile(env.account, normalizedServer);
            const profile = buildProfile(env.url, env.account, env.token, undefined, undefined, existingProfile);
            saveProfile(profile);
            return {
                client: createClient(env.url, env.token, clientOpts),
                profile,
            };
        }

        if (env.password) {
            const clientOpts = { insecure: options?.insecure, timeout: options?.timeout };
            const result = await login(env.url, env.account, env.password, clientOpts);
            const profile = buildProfile(env.url, env.account, result.token, undefined, result.user);
            saveProfile(profile);
            return {
                client: createClient(env.url, result.token, clientOpts),
                profile,
            };
        }
    }

    throw new ZentaoError('E1006');
}

/**
 * 尝试使用环境变量中的账号密码重新登录，以恢复因 Token 失效（如同账号网页端登录导致会话覆盖）
 * 而中断的 API 调用。
 *
 * 仅当 ZENTAO_URL / ZENTAO_ACCOUNT / ZENTAO_PASSWORD 环境变量齐全且与当前 profile 匹配时才会触发。
 * 不存储或记录密码，密码仅用于本次登录调用。
 *
 * @returns true 表示重连成功（client.token 和 profile.token 已更新），false 表示无法重连
 */
export async function tryReauth(client: ZentaoClient, profile: Profile): Promise<boolean> {
    const env = getEnvCredentials();
    if (!env.url || !env.account || !env.password) return false;

    const normalizedServer = env.url.replace(/\/+$/, '');
    if (normalizedServer !== profile.server || env.account !== profile.account) return false;

    try {
        const config = getProfileConfig(profile);
        const result = await login(profile.server, profile.account, env.password, {
            insecure: config.insecure,
            timeout: config.timeout,
        });
        client.token = result.token;
        profile.token = result.token;
        if (result.user) profile.user = result.user;
        profile.lastUsedTime = new Date().toISOString();
        saveProfile(profile);
        return true;
    } catch {
        return false;
    }
}
