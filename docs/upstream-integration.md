# Official-upstream integration

## Working agreement

For this repository, preserve the current branch and worktree before rebasing
onto the official upstream. Then inspect local feature branches and integrate
only changes that remain useful. When official code implements the same
capability, use the official implementation. Additional enhancements may be
ported separately after their behavior is reviewed and tested.

The official repository is `https://github.com/easysoft/zentao-cli.git`.
In this checkout its remote is `upstream`; `origin` is the existing fork.
Remote names on other machines are not interchangeable with these names.
Do not push rewritten history, publish packages, deploy, or update another host
as an implicit part of this local integration.

## 2026-10-22 baseline

- Official base: `a6c198952efb3e7262a8aaa4cbebbe381bc406cc`.
- Original local main: `8e4f6b21ac12f2dc6e9e3ae983501dd9cb98df68`.
- Preserved branch: `backup/main-before-official-rebase-20261022T060557Z`.
- Official package version stays `0.3.1`; SDK stays pinned to `0.8.1`.
- Git bundle, worktree archive, hashes, patches, and the user's edited pnpm
  lockfile are stored outside the repository under the local backup directory.
- Upstream uses `bun.lock`. The user's old pnpm lockfile is preserved as local
  work, rather than silently converting or committing it against the new SDK.

## Retained internal code

`src/modules/internal-actions.ts` adds only operations absent from the official
registry. Existing action names and matching HTTP method/path contracts win,
including after a future SDK update. The additions retain detail reads,
history/comments, assignment and workflow actions, and task work-hour CRUD.
They declare community ZenTao 22.4 as the minimum; other edition/version ranges
are not inferred from old unversioned definitions.

Binary attachment downloads use the SDK's custom request callback, preserving
its version check, HTTP errors, authentication source and cancellation. Files
are created exclusively, server filenames cannot select parent directories,
and remote HTTP MCP cannot write downloads to the server's local disk.

Multipart upload uses official `file create`, not the old `file upload` alias.
File rename follows official `fileName`, not the old internal `title` field.
Authentication, configuration, argument parsing, output processing, version
metadata, skills and lockfiles otherwise follow upstream.

The former global 22.4 query/body/schema overrides are not reapplied over
upstream operations. Full live-server parity is not implied by these unit tests;
any further legacy-server adaptations require separate evidence and changes.

## Local feature branches reviewed

| Branch | Decision |
|--------|----------|
| `feat/action-history-and-comments` | Retain missing actions through the additive adapter. |
| `feat/auto-pagination-all` | Defer; upstream explicitly rejects automatic `--all`. |
| `feat/mcp-batch-ids` | Defer extra MCP batching; retain upstream tool contracts. |
| `feat/options-json` | Defer extra JSON CLI options; retain upstream input contracts. |
| `fix/http-200-login-page` | Prefer upstream authentication and its tests. |
| `fix/validate-json-input` | Prefer upstream strict argument/body validation. |
| `chore/zentao-api-0.6.6` | Superseded by upstream SDK 0.8.1. |
| `fix/zentao-22.4-support` | Retain only missing actions; existing official definitions win. |

## Original main patch disposition

| Commit | Original change | Integration decision |
|--------|-----------------|----------------------|
| `344cb76` | * fix(render): output plain JSON for get actions instead of markdown box | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `7d3492e` | * fix(modules): add ZenTao 22.4 compatibility overrides | Retain missing detail/workflow actions only; upstream schemas and existing actions win. |
| `45bb61c` | * fix(executor): sync context/query params, add --all and server-side sort | Use upstream pagination and sorting; automatic --all remains deferred. |
| `0e92518` | * fix(args): parse space-form flags, register context ID options, fix ls callback | Use upstream explicit ID options and strict --field=value syntax. |
| `8453f63` | * fix(overrides): include project desc for 22.4 create | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `d9bac2f` | * fix(data): support = as equality operator in --filter to avoid silent match-all | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `9fb561c` | * fix(executor): merge non-schema flag params into body so create flags reach server | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `37fe0fe` | * fix(mcp): cast zod shapes to bridge Zod 4 type incompatibility with MCP SDK | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `ba4da14` | * fix(render): respect machine-readable and no-color flags to disable ANSI output | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `f4048a4` | * format: show 没有数据 for empty list without pager | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `4ff6f13` | * args: normalize prefixed IDs like case_48 to numeric for ZenTao 22.x | Use upstream numeric-ID contract; prefixed IDs remain deferred. |
| `fddb770` | * executor: map short context (--product/--project/--execution) to body fields for create actions | Use upstream scope aliases; extra create aliases remain deferred. |
| `2b278f9` | * module-handler: show 操作成功 when create/update/action returns empty data | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `bd4ef60` | * args: accumulate repeated flags (reviewer/openedBuild) and accept dash-leading values; module-handler: validate ID before delete confirm prompt | Use upstream parser and JSON arrays; permissive/repeated-flag extensions remain deferred. |
| `dd29421` | * module-handler: route get --format json through formatOutput for consistent wrapped compact JSON output | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `990dfc7` | * args: validate --data and positional JSON upfront, throw E2007 on invalid JSON instead of silently passing garbage to server | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `7dcff1a` | + cli-options: implement --options JSON form to pass CLI options as JSON object (was registered and documented but never parsed) | Defer --options JSON; use upstream options and --params/--data. |
| `f3e52d8` | + mcp: expose all and limit options in module tools for complete dataset access | Use upstream MCP limits and pagination contract; defer --all. |
| `25a7366` | + test: add regression tests for repeated flag accumulation, dash-leading values, bare flags, and --data JSON validation | Use upstream write-argument tests; do not restore old parser semantics. |
| `24de7d9` | * merge: ZenTao 22.4 full compatibility (fix/zentao-22.4-support) | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `d732242` | * release v0.3.0 | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `82d270e` | + action-history: add history and comment actions for all object modules, add feedback/ticket assignto | Retain additive history/comment and assignment actions. |
| `e06d79c` | + task-effort: add recordestimate and effort actions for per-entry work logs | Retain task recordestimate/effort actions on the new SDK. |
| `c943a57` | * fix: strict ID parsing, stderr errors, --all warnings, MCP batch, double sort, token detection | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `372098a` | * fix: auto-reauth on token invalidation from web login session conflict | Use upstream auth; do not restore automatic credential refresh. |
| `01d3dbb` | * fix: cover real-world 401+Not-allowed auth case, fix task effort path, add file rename | Retain effort route and HTTP error regression coverage; use upstream file rename. |
| `3af458b` | + task-effort: add editeffort and deleteeffort actions, complete effort CRUD | Retain effort edit/delete actions. |
| `fc5af1c` | * fix: correct 403 error mapping, fix effort resultGetter and query param workaround | Retain effort map extraction and legacy query-ID hooks; use upstream 401/403 mapping. |
| `19983fe` | + file-download: implement binary file download with Content-Disposition parsing | Retain binary download through the SDK custom-request callback. |
| `720e1cf` | * release v0.4.0 | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `b4246b4` | + file-upload: implement multipart attachment upload with object attachment | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `9fe2931` | * release v0.5.0 | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `d047e9e` | * fix: preserve Bug history permission diagnostics | Use upstream implementation/SDK and release metadata; do not replay this patch. |
| `8e4f6b2` | * Refine ignore rules for Bun CLI development | Use upstream .gitignore; keep the earlier customization on the backup branch. |

## Verification

Run `bun run typecheck`, `bun test`, `bun run build`, and
`node bin/zentao.js -V`. Internal regression tests exercise real HTTP requests
against loopback fixtures, work-hour request bodies, history permission errors,
binary downloads, non-overwrite behavior, official-action precedence and remote
MCP file restrictions. They do not authenticate to or mutate a real ZenTao site.

The upstream browser-opener test needs an explicitly nonexistent PATH directory
on this macOS/Bun environment: an empty PATH can fall back to system commands.
This is a test-fixture change; the official browser/authentication source is
unchanged.

Observed local result: 428 tests passed, 0 failed; typecheck and build passed;
Node CLI reported version `0.3.1`. A registry comparison preserved all 361
official action contracts and found 60 additive internal actions. These results
cover local fixtures and build output, not live-site acceptance or deployment.
