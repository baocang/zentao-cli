import { describe, expect, test } from 'bun:test';
import { assertAuthenticatedPayload, isLoginPageHtml } from '../src/auth/response';

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="zh-cn">
<body><form id="loginForm"><input name="account"><input name="password"></form></body>
</html>`;

describe('ZenTao authentication response detection', () => {
    test('recognizes an HTTP 200 ZenTao login page', () => {
        expect(isLoginPageHtml(LOGIN_PAGE)).toBe(true);
        expect(() => assertAuthenticatedPayload(LOGIN_PAGE)).toThrow(expect.objectContaining({ code: '1004' }));
    });

    test('does not reject ordinary HTML returned as business data', () => {
        const html = '<p>Bug description</p>';
        expect(isLoginPageHtml(html)).toBe(false);
        expect(() => assertAuthenticatedPayload(html)).not.toThrow();
    });

    test('does not reject a generic full HTML document without login controls', () => {
        const html = '<!DOCTYPE html><html><body><article>API documentation</article></body></html>';
        expect(isLoginPageHtml(html)).toBe(false);
        expect(() => assertAuthenticatedPayload(html)).not.toThrow();
    });

    test('requires both a ZenTao login marker and account input', () => {
        const unrelatedForm = '<!DOCTYPE html><html><form><input name="account"></form></html>';
        const incompleteLogin = '<!DOCTYPE html><html><form id="loginForm"></form></html>';
        expect(isLoginPageHtml(unrelatedForm)).toBe(false);
        expect(isLoginPageHtml(incompleteLogin)).toBe(false);
    });
});
