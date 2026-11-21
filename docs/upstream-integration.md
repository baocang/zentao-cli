# Official-upstream integration

## Working agreement

Before rebasing, back up the current branch and all staged, unstaged and untracked
work. Rebase onto the official repository at
`https://github.com/easysoft/zentao-cli.git`, then review local feature branches
and integrate only changes that remain useful. Prefer official implementations
when capabilities overlap; keep only our enhancement deltas on top of them, and
port unique features separately with tests. Resolve remote names from their URLs
rather than assuming names match across machines. Rebasing and local commits do
not authorize pushing, publishing, deploying or changing another host.

## Internal extensions

`src/modules/extensions.ts` registers operations absent from the SDK registry
(`applyRegistryExtensions()`, applied at CLI and MCP startup). Existing official
action names and HTTP method/path contracts take precedence, including after an
SDK update. Extensions cover detail reads, history, comments, workflow actions
and task work-hour records. Their minimum supported version is community ZenTao
22.4; support for other editions is not inferred.

Binary attachment downloads share the official streaming downloader
(`src/commands/file-download.ts`): version checks, authentication, errors and
cancellation go through the SDK request callback, bytes stream to a temporary
file that is renamed into place only after the download completes.
`zentao file download` names the target from the server's Content-Disposition
header and never overwrites existing files; server filenames cannot choose
parent directories. `zentao file read --output` follows the official contract
and replaces the target file after a complete download. Uploads, renames and
comment image embedding use official `file create` and `fileName` contracts.

HTTP MCP denies server-local file uploads by default; the opt-in
`ZENTAO_MCP_UPLOAD_ROOT` allowlist is the only exception, and paths outside the
resolved root are rejected.

## Dependencies and validation

Use `bun.lock` as the dependency lockfile, matching CI. After dependency updates,
verify a frozen install; do not maintain a second lockfile with different
resolutions.

Run the local checks from the repository root:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run scripts/generate-command-reference.ts --check
bun run build
node bin/zentao.js -V
```

The regression tests use local fixtures to verify official-action precedence,
HTTP error handling, work-hour bodies, downloads and MCP file restrictions.
Passing these checks does not establish live-site acceptance.
