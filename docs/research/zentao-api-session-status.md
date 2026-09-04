# ZenTao API Session GC Status

Checked: 2026-09-04

## Conclusion

As of the latest upstream open-source tag, `zentaopms_22.5_20260820`, there is
no released fix that can be shown to eliminate the API-session GC timing bug.
The upstream default branch at commit
[`ab2efdde`](https://github.com/easysoft/zentaopms/commit/ab2efdde9fb7d9b3434b37fca4d61216750ee4af)
(2026-08-21) retains the same startup ordering and GC check, so no later fix is
present on the public main branch as of the check date either.

ZenTao 22.5 contains an apparent fix in commit
[`083d09ca`](https://github.com/easysoft/zentaopms/commit/083d09ca5398321e1057f3942d6f0e8ad2ab843a):
`ztSessionHandler::gc()` changed from checking the late-defined `RUN_MODE` to
calling `helper::isApiRequest()`. However, the new helper relies first on the
global `$app`, and that global has not yet been assigned when `session_start()`
can invoke GC. Its fallback still checks the same late-defined `RUN_MODE`.
Consequently, the normal token-header request still reaches the GC body.

The accurate status is therefore: **22.5 attempted to address the condition,
but the current constructor and entry-point ordering leaves the original GC
window open. Do not treat upgrading from 22.4 to 22.5 alone as a verified
resolution.**

## Version and source evidence

- The current upstream version tag is
  [`zentaopms_22.5_20260820`](https://github.com/easysoft/zentaopms/tree/zentaopms_22.5_20260820),
  whose `config/config.php` declares version 22.5. The upstream
  [`doc/CHANGELOG`](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/doc/CHANGELOG)
  has a 22.5 section, but does not list this API-session GC problem as a fixed
  bug.
- The relevant change was introduced by upstream commit
  [`083d09ca5398321e1057f3942d6f0e8ad2ab843a`](https://github.com/easysoft/zentaopms/commit/083d09ca5398321e1057f3942d6f0e8ad2ab843a)
  on 2026-08-13 and is included in the 22.5 tag.
- The 22.4 implementation skips GC only when `RUN_MODE == 'api'` (or a session
  ID is supplied in the query string):
  [22.4 `ztSessionHandler::gc()`](https://github.com/easysoft/zentaopms/blob/zentaopms_22.4_20260730/framework/base/router.class.php#L3971-L3989).
- The 22.5 implementation instead calls `helper::isApiRequest()`:
  [22.5 `ztSessionHandler::gc()`](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/framework/base/router.class.php#L3971-L3993).
- Version 22.5 also adds `$config->sessionLife = 86400` and applies it to
  `session.gc_maxlifetime` before starting the session:
  [22.5 default configuration](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/config/config.php#L19-L28),
  [22.5 session lifetime application](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/framework/base/router.class.php#L1251-L1257).
  This changes the common expiry window from PHP's configured value (often
  1440 seconds) to one day, but only delays the defect.

## Why the 22.5 change is still ineffective

The request executes in this order:

1. `www/api.php` evaluates `$app = router::createApp(...)` at line 32. The
   assignment cannot complete until `createApp()` and the new object's
   constructor return:
   [22.5 API entry point](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/www/api.php#L28-L44).
2. The API router constructor identifies the API version, then calls the
   parent constructor at line 168:
   [22.5 API router constructor](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/framework/api/router.class.php#L150-L174).
3. The parent constructor calls `setClient()` before returning, and
   `setClient()` calls `startSession()`:
   [22.5 base router constructor](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/framework/base/router.class.php#L499-L551).
4. `startSession()` installs `ztSessionHandler` and calls `session_start()` at
   line 1257. PHP may invoke the handler's `gc()` during that call:
   [22.5 session startup](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/framework/base/router.class.php#L1226-L1257).
5. At that instant, the assignment in step 1 has not completed, so the global
   `$app` used by `helper::isApiRequest()` is not the API router object. The
   helper then falls back to `RUN_MODE`:
   [22.5 `helper::isApiRequest()`](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/framework/base/helper.class.php#L927-L942).
6. `RUN_MODE` is not defined until line 44 of `www/api.php`, after construction
   and therefore after `session_start()`. For a normal CLI request using the
   `Token` header, the separate query-string-session exception in `gc()` also
   does not apply.

The stale-file behavior is also unchanged. `ztSessionHandler::write()` returns
without rewriting or touching the session file when its serialized content is
unchanged, so an actively used token can retain an old mtime:
[22.5 session write implementation](https://github.com/easysoft/zentaopms/blob/zentaopms_22.5_20260820/framework/base/router.class.php#L3934-L3953).
The still-reachable GC loop deletes files whose mtime exceeds
`gc_maxlifetime`. The new one-day default therefore makes the symptom less
frequent but does not make an actively used token sliding or non-expiring.

## What would constitute a real fix

A robust fix must make API detection available before `session_start()`, or
make `gc()` decide from state already available to the handler. Examples are:

- define API mode before constructing the router;
- pass an explicit API/no-GC flag into `ztSessionHandler`; or
- have `gc()` identify the configured `apisession` save path (including the
  configurable `ZT_APISESSION_PATH`) rather than consulting late global state.

Until an upstream release contains such a change and the startup sequence is
verified, keep the existing server-side patch/workaround. A dedicated CLI
account and automatic re-login reduce operational impact, but do not repair the
session lifetime defect.
