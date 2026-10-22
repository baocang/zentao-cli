# Official-upstream integration

## Working agreement

Before rebasing, back up the current branch and all staged, unstaged and untracked
work. Rebase onto the official repository at
`https://github.com/easysoft/zentao-cli.git`, then review local feature branches
and integrate only changes that remain useful. Prefer official implementations
when capabilities overlap; port additional enhancements separately with tests.
Resolve remote names from their URLs rather than assuming names match across
machines. Rebasing and local commits do not authorize pushing, publishing,
deploying or changing another host.

## Internal extensions

`src/modules/internal-actions.ts` registers only operations absent from the SDK.
Existing official action names and HTTP method/path contracts take precedence,
including after an SDK update. Extensions cover detail reads, history, comments,
workflow actions and task work-hour records. Their minimum supported version is
community ZenTao 22.4; support for other editions is not inferred.

Binary attachment downloads use the SDK request callback for version checks,
authentication, errors and cancellation. Downloads never overwrite existing
files, and server filenames cannot choose parent directories. HTTP MCP denies
server-local download writes. Uploads and renames use official `file create`
and `fileName` contracts.

Do not restore legacy global schema overrides or deferred CLI behavior such as
`--all`, permissive arguments and automatic reauthentication without a separate,
verified requirement.

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
