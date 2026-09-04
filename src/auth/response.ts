import { ZentaoError } from '../errors.js';

const HTML_DOCUMENT_RE = /^\s*<!doctype\s+html\b|^\s*<html\b/i;
const LOGIN_FORM_RE = /(?:id|name)\s*=\s*["']loginForm["']|user-login(?:\.html)?/i;
const ACCOUNT_INPUT_RE = /<input\b[^>]*\bname\s*=\s*["']account["'][^>]*>/i;
const RAW_RESPONSE_SCAN_LIMIT = 64 * 1024;

/** ZenTao may return its login page with HTTP 200 when a token is no longer authenticated. */
export function isLoginPageHtml(value: unknown): value is string {
    return typeof value === 'string'
        && HTML_DOCUMENT_RE.test(value)
        && LOGIN_FORM_RE.test(value)
        && ACCOUNT_INPUT_RE.test(value);
}

/** Convert ZenTao's HTTP-200 login-page response into the normal expired-token error path. */
export function assertAuthenticatedPayload(value: unknown): void {
    if (isLoginPageHtml(value)) {
        throw new ZentaoError('E1004', undefined, { responseType: 'login-page' });
    }
}

/** Validate raw Response results without consuming a legitimate attachment body. */
export async function assertAuthenticatedResponse(response: Response): Promise<void> {
    const disposition = response.headers.get('Content-Disposition') ?? '';
    if (/\battachment\b/i.test(disposition)) return;

    const contentType = response.headers.get('Content-Type') ?? '';
    if (!/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)) return;

    const reader = response.clone().body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let body = '';
    let bytesRead = 0;

    try {
        while (bytesRead < RAW_RESPONSE_SCAN_LIMIT) {
            const result = await reader.read();
            if (result.done) {
                assertAuthenticatedPayload(body + decoder.decode());
                return;
            }

            const remaining = RAW_RESPONSE_SCAN_LIMIT - bytesRead;
            const chunk = result.value.subarray(0, remaining);
            bytesRead += chunk.byteLength;
            body += decoder.decode(chunk, { stream: bytesRead < RAW_RESPONSE_SCAN_LIMIT });
            assertAuthenticatedPayload(body);
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ZentaoError('E5001', undefined, error);
        }
        throw error;
    } finally {
        await reader.cancel().catch(() => undefined);
    }
}
