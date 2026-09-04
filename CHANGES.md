# Changes

## 0.5.0

### ✨ 新特性 (Feat)

- **附件上传**: `file` 模块新增 `upload` 操作，通过 multipart/form-data 上传附件并可直接挂载到业务对象。
  - `zentao file upload ./报告.png --objectType=bug --objectID=123` — 上传并附加到 Bug 123。
  - `zentao file upload ./日志.txt` — 仅上传不入库对象（objectType/objectID 可选）。
  - CLI 与 MCP 一致（MCP 通过 `params.file` 传本地路径）；支持 Token 失效自动重连。
  - MCP 上传默认禁用，设置 `ZENTAO_MCP_UPLOAD_ROOT` 后仅允许读取指定目录；附件最大 50 MiB，业务失败不再误报成功。
  - 修正 SDK 生成的 `file create` 误导描述，统一引导使用 `file upload`（ZenTao 将 POST /files 特殊路由到 ajaxUpload，仅接受 multipart 表单，JSON 形式无法成功）。
  - 已验证上传、挂载、下载与删除的完整附件流程。

### 🐛 修复 (Fix)

- **登录页响应识别**: 兼容禅道在 Token 失效时返回 HTTP 200 登录页的行为，统一映射为 E1004 并进入现有自动重连流程，避免查询静默返回空数据、上传误报成功或下载保存登录页。
- **原始响应超时**: 升级 `zentao-api` 至 0.6.6，下载等原始响应在读取 body 期间继续受请求超时和取消信号约束。
- **升级与 MCP 配置**: 自动更新及 `add-mcp` 生成的启动命令统一使用 `@baocang/zentao-cli`，避免访问同名未 scoped 包。

### ✅ 测试 (Test)

- 补充登录页严格指纹、HTML 附件放行、流式响应超时和 multipart 二进制上传回归测试。

### 🤸 技能更新（Skill）

- **zentao-cli**: 更新 scoped 包安装方式、附件上传/下载能力和自动重连说明。
- **zentao-tour**: 更新 scoped 包安装与 MCP 启动方式。

## 0.4.0

### ✨ 新特性 (Feat)

- **Token 自动重连**: 当 API 调用因 Token 失效返回 401 时，CLI 自动使用环境变量 `ZENTAO_PASSWORD` 重新登录并重试，无需手动干预。
- **操作历史与备注**: 所有业务对象模块（bug/task/story/epic/requirement/testcase/feedback/ticket/product/project/execution/build/release/testtask/productplan/program）新增 `history` 和 `comment` 扩展操作。
  - `zentao bug history 123` — 查看 Bug 123 的操作历史（opened/resolved/closed/commented 等），支持 `--filter`/`--sort`/`--pick` 等列表处理。
  - `zentao bug comment 123 --comment="备注内容"` — 为 Bug 123 添加备注，无需改变状态。
  - 解决 AI agent 反馈的"CLI 不提供历史记录与备注，需用浏览器获取"的问题。
- **附件重命名**: `file` 模块新增 `update` 操作（API v2 3.7.2 编辑附件），支持修改附件名称。
- **任务工时记录**: `task` 模块新增 `recordestimate`（记录工时）和 `effort`（查看工时记录）扩展操作。
  - `zentao task recordestimate 123 --consumed=2 --left=5 --work="完成了前端页面开发"` — 记录单条工时（逐条工作内容）。
  - `zentao task effort 123` — 查看任务的逐条工时记录（日期、工作内容、耗时、剩余）。
  - 解决 AI agent 反馈的"CLI 能提供任务状态和预计/已耗/剩余工时，但不直接返回逐条工作内容"的问题。
- **反馈/工单指派**: `feedback` 和 `ticket` 模块新增 `assignto` 扩展操作，与 bug/task/story 保持一致。
- **MCP 批量操作**: MCP 工具新增 `ids` 数组参数，支持 AI agent 批量 get/update/delete。

### 🐛 修复 (Fix)

- **ID 解析安全加固**: `register-modules.ts` 和 `crud.ts` 中改用 `/^\d+$/` 严格整数校验，修复 `1e2`、`0x10`、空字符串等被误判为有效 ID 的问题。
- **错误输出到 stderr**: `register-modules.ts` 和 `crud.ts` 的 `ZentaoError` 输出从 `console.log`（stdout）改为 `console.error`（stderr），修复管道输出被错误信息污染的问题。
- **--all 分页失败告警**: 自动翻页拉取全部数据时，单页失败不再静默中断，改为向 stderr 输出进度告警。
- **create 不再吞掉位置参数**: `crud.ts` 的位置参数 ID 解析跳过 `create` 操作，避免 `zentao create bug 1 --title=x` 中 `1` 被误吞为 ID。
- **Token 检测改进**: 登录时的 Token 判定从固定 40 字符长度改为 `/^[a-f0-9]{32,64}$/i` 正则匹配，兼容不同长度和格式的 ZenTao Token。
- **bug confirm 补全字段**: `confirm` 操作的 schema 补充 `assignedTo` 字段，使 help 输出和参数校验与实际 API 一致。
- **避免重复排序**: 当 `--sort` 已转发为服务端 `orderBy` 时，跳过客户端重复排序。
- **applyOptionsJson 清理**: 合并后删除残留的 `options` JSON 字符串字段，避免参数污染。
- **getCmd allowUnknownOption**: `zentao get` 命令补充 `allowUnknownOption(true)`，与其他 CRUD 命令保持一致。
- **批量操作输出分隔**: markdown 格式下批量操作结果之间增加 `---` 分隔线，避免混淆。
- **鉴权错误精准识别**: 401 映射为 E1004（Token 失效），403 映射为 E2006（权限不足），避免因权限不足触发无效重连。
- **E1004 错误消息改进**: 明确提示"可能是同账号网页端登录导致会话被覆盖"，并引导用户设置 `ZENTAO_PASSWORD` 环境变量以启用自动重连。
- **MCP 工具自动重连**: MCP 工具（含批量模式）同样支持 Token 失效后自动重连，第一次 auth 错误触发重连尝试。

### 🚀 优化与重构 (Refactor)

- **getAction 查找增强**: 非标准 CRUD 名称的 action 查找不再仅限于 `type='action'`，也支持 `type='list'` 等非 CRUD 类型（如 `history`），使自定义列表型扩展操作可被正常解析和渲染。
- **getAvailableActions 范围扩大**: 扩展操作列表按名称过滤（排除标准 CRUD 名称）而非仅按 `type='action'` 过滤，确保 `history` 等非 `type='action'` 的扩展操作在 help 中正确展示。
- **help 展示修正**: 模块 help 和 action help 统一使用 `getAction()` 解析扩展操作，修复了 `history` 操作在 help 中显示为原始名称而非中文描述的问题。

### ✅ 测试 (Test)

- 新增 `action history & comments` 测试组：验证所有对象模块的 history/comment action 定义、路径、类型、body schema 和 getAction/getAvailableActions 解析。
- 新增 `missing workflow actions` 测试组：验证 feedback/ticket 的 assignto 操作、task 的 recordestimate/effort 操作。
- 新增 `bugfixes` 测试组：验证严格 ID 解析（拒绝 `1e2`/`0x10`）、applyOptionsJson 清理残留字段、bug confirm 包含 assignedTo。

## 0.3.0

### ✨ 新特性 (Feat)

- **ZenTao 22.4 全面兼容**: 新增 `src/modules/overrides.ts`，在 CLI 启动时自动修正 SDK 注册表与 ZenTao 22.4 的差异，覆盖产品维度创建（productID 查询参数化）、缺失的 get 动作（project/build/release/system/testtask）、缺失的工作流操作（bug confirm/assignto、task pause/cancel/restart/assignto、story/epic/requirement review/assignto、testcase review、testtask start/close/activate/block）。
- **`--all` 全量拉取**: 列表操作支持 `--all` 自动翻页，直到获取全部数据。
- **服务端排序**: `--sort` 现转发为 API `orderBy` 查询参数，在服务端排序后再分页，而非仅客户端当页排序。
- **`--options` JSON 形式**: 支持 `--options '{"format":"json",...}'` 一次性传入 CLI 选项。
- **MCP 工具增强**: 暴露 `all` 和 `limit` 选项到 MCP 工具，支持完整数据集访问。

### 🐛 修复 (Fix)

- **JSON 输出修复**: `--format=json` 的 get 操作不再产生 Markdown ANSI 框线乱码，始终输出纯 JSON。
- **`--key value` 空格形式解析**: create/update/action 的 `--name "x"` 等空格分隔 flag 不再被静默丢弃；同时支持重复 flag 累积（如 `--reviewer`）和 dash 开头的值。
- **ls/list 选项丢失修复**: `ls` 命令的 action 回调签名修正，`--page`/`--recPerPage`/`--sort`/`--filter`/`--project` 等选项不再被丢弃。
- **上下文 ID 选项注册**: `--executionID`/`--productID`/`--projectID` 注册为 Commander 选项，空格和等号形式均可解析。
- **短名上下文映射**: `--product`/`--project`/`--execution` 自动映射到路径和请求体所需的 productID/projectID/executionID。
- **testcase 前缀 ID**: ZenTao 22.x 返回 `case_48` 形式的 ID，自动归一化为数字。
- **空数据提示**: 列表为空且无 pager 时显示"没有数据"；create/update/action 返回空数据时显示"操作成功"。
- **--filter 等号支持**: `--filter 'status=closed'` 中 `=` 作为等于运算符，不再被误认为静默匹配全部。
- **machine-readable 模式**: 正确禁用 ANSI 颜色输出。
- **MCP Zod 4 兼容**: 修复 Zod 4 类型与 MCP SDK 的不兼容问题。

### 🚀 优化与重构 (Refactor)

- **参数同步机制**: executor 新增 `syncQueryParams`（从 --data JSON 同步查询参数）和 `syncContextParams`（短名→全名映射），确保参数在所有接口形式下正确传递。
- **非 schema flag 合并**: create 操作中未在 requestBody schema 中声明但通过 flag 传入的参数，合并到请求体发送给服务端。

### ✅ 测试 (Test)

- 新增回归测试覆盖重复 flag 累积、dash 开头值、裸 flag、`--data` JSON 校验等边界场景。

## 0.2.0

### 🐛 修复 (Fix)

- **更新检查**: 修正版本更新检查逻辑，仅解析最新的稳定版本并跳过预发布版本，避免误提示升级到 beta/rc 版本。

### 🚀 优化与重构 (Refactor)

- **迁移至 zentao-api SDK**: 将禅道 API 层(HTTP 客户端、模块注册表、请求解析、响应提取、数据工具与错误类型)整体迁移到外部 [`zentao-api`](https://github.com/easysoft/zentao-api) 包,CLI 专注于命令行/MCP 相关职责(参数解析、渲染、帮助、配置/工作区、登录流程)。
- **命令执行链路重构**: 认证、模块命令与 MCP 服务全面改由 zentao-api 客户端驱动;模块的解析与执行统一通过 SDK 的 `request()` 完成,CLI 侧仅保留 HTML→Markdown 转换与过滤/搜索/排序/裁剪等后处理。
- **依赖精简**: 移除 `dot-prop` 依赖及 `update-registry` 脚本;升级 `zentao-api` 至 0.4.1。

### ✅ 测试 (Test)

- **测试套件适配**: 更新测试套件以匹配基于 zentao-api 的新架构。

### 📝 文档 (Docs)

- **架构文档更新**: 在项目文档中说明基于 zentao-api 的分层架构,并移除已废弃的 OpenAPI 相关描述。

## 0.1.8

### 🚀 优化与重构 (Refactor)

- **登录模块拆分**: 将 token 校验逻辑抽取为独立的 `verifyToken`，并将环境变量读取逻辑抽取为 `getEnvCredentials`，提升可复用性与可测试性，外部行为保持不变。

### ✅ 测试 (Test)

- **auth 单元测试**: 新增 `tests/auth.test.ts`，基于本地 mock 服务覆盖 `verifyToken` 的关键分支（用户命中/未命中、`/users` 401、空列表、缺失字段、`/server/config` 5xx、Token 头与查询参数）以及 `getEnvCredentials` 在环境变量缺失/设置下的读取行为。

### 📝 文档 (Docs)

- **release 工作流**: 在 `/release` 斜杠命令中新增可选的 npm 发布步骤，统一发布 CLI 包到 npm 的操作流程。
- **提交规范**: AGENTS.md 明确要求提交信息必须使用英文，统一项目协作规范。

## 0.1.7

### ✨ 新特性 (Feat)

- **更新操作自动补全**: 模块命令的 update 操作在执行前会自动读取当前对象，并将缺失字段补全到提交数据中，避免因仅提交部分字段而导致后端校验失败或数据被清空。

### ✅ 测试 (Test)

- **executor 测试**: 新增覆盖 update 操作自动补全行为及错误路径的单元测试。

### 📝 文档 (Docs)

- **release 工作流**: 新增 `/release` 斜杠命令，将版本号确定、`CHANGES.md` 更新与 git tag 打包成标准化的发布流程，并在工作流中加入技能版本号同步步骤。

### 🤸 技能更新（Skill）

- **zentao-cli**:
  - 更新 update 操作的参数说明，明确缺失字段会从当前对象自动补全，无需手动重复传入完整字段。

## 0.1.6

### 🤸 技能更新（Skill）

- **凭证安全**: 新增凭证安全提示，严禁主动读取本地保存的禅道密码和 Token，包括环境变量 `ZENTAO_PASSWORD` 和 `ZENTAO_TOKEN`，以及配置文件 `~/.config/zentao/zentao.json` 中的数据，一切数据都通过 `zentao` 命令获取。

## 0.1.5

### 🚀 优化与重构 (Refactor)

- **批量 ID 处理**: 新增 `splitNumericIds` 与 `pickBatchIds` 工具函数，支持模块命令中批量 ID 的解析与处理；增强删除操作的交互确认逻辑以适配批量场景。
- **模块命令执行重构**: 引入 `renderModuleExecution` 统一管理命令执行与输出格式化，精简冗余函数，提升代码可读性与可维护性。
- **死代码清理**: 移除各模块及命令逻辑中未使用的工具函数导出与冗余代码。
- **依赖升级**: 升级 `@types/bun` 和 `bun-types` 至 1.3.13；新增类型检查、覆盖率及 CI 自动化脚本。

### ✅ 测试 (Test)

- **单元测试扩展**: 新增共享测试辅助模块 `tests/helpers.ts`；`api.test.ts` 从 4 项扩展至 21 项测试（含 mock 服务、Token、HTTP 错误、超时等场景）；新增 `config.test.ts` 共 24 项配置管理测试；`data.test.ts` 与 `mcp-schema.test.ts` 补充多项边界用例。
- **MCP 端到端测试增强**: 为 `zentao_bug` 工具新增 `readOnlyHint` 与 `destructiveHint` 注解属性断言。

### 📝 文档 (Docs)

- **CLAUDE.md**: 新建并持续优化 AI 辅助开发参考文档，涵盖项目概览、命令用法、架构细节、提交规范与测试指南。
- **文档结构重组**: 集中整理文档目录，移除遗留的静态引导页 `index.html`。

## 0.1.4

### ✨ 新特性 (Feat)

- **--help 标志支持**: 为模块命令新增 `--help` / `-h` 标志支持，解析器可智能识别标志后的操作名称（含别名），并展示对应操作的详细帮助信息。

### 🐛 修复 (Fix)

- **错误码修正**: 修复模块命令解析器中路径参数缺失时错误抛出 `E2004` 的问题，现正确抛出 `E2003`（缺少必要参数）。
- **任务列表路径修正**: 将任务列表 API 路径从泛化的 `/{scope}/{scopeID}/tasks` 简化为 `/executions/{executionID}/tasks`，移除多余的 scope 参数抽象。
- **错误提示一致性**: 将错误信息中的帮助命令引用从 `--help` 统一修正为 `help` 子命令形式。

### 📝 文档 (Docs)

- **README 更新**: 将帮助命令示例从 `--help` 标志统一修正为 `help` 子命令，与 CLI 实际行为保持一致。
- **SKILL.md 更新**: 完善错误码表中的帮助命令引用，补充模块与操作级别的帮助查看方式说明。

## 0.1.3

### ✨ 新特性 (Feat)

- **访问控制默认值**: 为模块定义中的 `acl` 字段补充默认值 `open`，简化访问控制配置并提升创建参数的可用性。


## 0.1.2

### ✨ 新特性 (Feat)

- **版本查询别名**: 支持 `zentao --version` 命令别名，可同时显示 CLI 版本与禅道服务器版本信息。
- **数组类型解析**: 增强模块命令解析器，新增对数组元素类型（array item types）的识别与处理，并完善了对 `undefined` 值的兼容。

### 📝 文档 (Docs)

- **README 更新**: 补充更多主流 AI Agent 平台的技能安装说明，并增加 `zentao-cli` 升级命令示例。

## 0.1.2-beta.9

### ✨ 新特性 (Feat)

- **多技能目录支持**: 重构 `add-skill` 安装流程，支持在同一技能仓库中管理和递归复制多个技能目录。
- **禅道新手导览**: 新增 `zentao-tour` 技能文档，提供按角色（产品经理/项目经理/测试/开发/高管）分类的上手引导。
- **模块命令别名**: 为模块注册系统增加命令别名映射，提升命令输入的灵活性与容错能力。

### 🐛 修复 (Fix)

- **安装命令修正**: 修正了 README 中技能安装命令的冗余参数。

## 0.1.2-beta.8

### ✨ 新特性 (Feat)

- **帮助命令增强**: 优化 `zentao help <module>` 命令逻辑，支持 CRUD 操作别名识别（如 `ls` → `list`），改善 Action 解析的准确性与用户体验。

## 0.1.2-beta.7

### ✨ 新特性 (Feat)

- **计划关联字段**: 在模块定义中新增 `plan` 字段，支持创建需求时关联产品计划；同时将 `category` 类型调整为 `string` 以增强扩展性。
- **类型校验错误码**: 新增错误码 `E2010` 用于 `resolveModuleCommand` 中的参数类型校验，并增强了参数处理逻辑。

### 📝 文档 (Docs)

- **技能文件更新**: 在 SKILL.md 中补充了需求创建时关联计划的说明。

## 0.1.2-beta.6

### ✨ 新特性 (Feat)

- **命令行中文化**: 对帮助输出信息进行了本地化适配，将命令描述文本全面更新为中文。

### 🐛 修复 (Fix)

- **类型检查修正**: 修复 `resolveModuleCommand` 中 `data` 参数的类型检查逻辑，确保对象类型被正确处理。
- **描述格式修正**: 修正模块注册中的描述文本格式化问题，提升可读性。

### 🚀 优化与重构 (Refactor)

- **认证流程精简**: 移除了认证流程中的 Token 校验逻辑，简化登录鉴权过程。
- **Bun 环境检测**: 精简 Bun 运行环境检测代码，移除冗余逻辑，改为直接导入 `bunMarkdownEnable`。
- **动态版本获取**: 将硬编码的 `BUILD_VERSION` 替换为 `getCliVersion` 函数，实现运行时动态获取版本号。
- **类型定义更新**: 更新模块类型定义（`ModuleDefinition`），同步项目路线图文档。

### 📝 文档 (Docs)

- **README 完善**: 改善了 README 中首次登录与命令使用的说明清晰度，修正 `ZENTAO_TOKEN` 描述的格式，优化 AI 技能使用说明。

## 0.1.2-beta.5

### ✨ 新特性 (Feat)

- **自定义配置路径**: 支持配置数据存储路径以满足不同运行环境的要求。
- **模块帮助命令**: 新增 `zentao help <module>` 命令，用于显示各模块的具体命令用法与操作支持情况。
- **列表截断支持**: 增强列表操作执行逻辑，支持在查询列表时限制返回数量。

### 🐛 修复 (Fix)

- **参数解析**: 优化了模块命令执行过程中的参数解析能力，支持通过附加参数解析 JSON 数据，并补充了缺少参数时的降级获取机制（如 `pageID`, `scopeID` 和 `order`）。
- **客户端完善**: 增强了 API 客户端层面的错误处理，并改善了鉴权逻辑（更健壮的 Token 校验）。
- **分页信息修复**: 修复了格式化分页信息在数据集为空时抛出异常的问题。

### 🚀 优化与重构 (Refactor)

- **路径解析**: 移除冗余的列表路径解析器 `resolveListPathParams` 以简化处理流程。
- **代码清理**: 移除了无用类型文件和冗余的控制台调试日志输出。

### 📝 文档 (Docs)

- **README 更新**: 完善了对象预设字段表和国际化（i18n）相关的文档内容，并增加了功能待办进度清单。
- **技能文件**: 更新了针对 Agent 使用的技能文档 (`zentao-cli` skill)。

## 0.1.2-beta.4

### 🚀 优化与重构 (Refactor)

- **版本更新检测**: 采用更严谨的 SemVer 规范对比逻辑（支持 alpha、beta 等预发布版本的比较），提高更新提示的准确性。
- **环境检测适配**: 升级包管理器检测机制，能更精准地识别 npm、yarn、pnpm 或 bun，并针对不同平台（支持 Windows）生成正确的跨平台更新安装命令。

### 📝 文档 (Docs)

- **文档结构重构**: 优化说明文档结构，将技术实现细节、开发指南、错误码和架构设计等独立拆分至 `docs/` 目录下，精简 `README.md` 的内容。
- **路线图**: 更新了 `PLAN.md` 文件中的项目路线图与待办任务优先级。

### ✅ 测试 (Test)

- **单元测试**: 为语义化版本（SemVer）的解析、版本对比以及跨平台安装命令生成补充了完整的单元测试，保证逻辑的可靠性。

## 0.1.2-beta.3

### ✨ 新特性 (Feat)

- **自动检查更新**: 增加了每天首次使用的自动版本检查与更新提示机制。
- **命令行升级**: 新增 `upgrade` 命令，支持一键检测并通过 npm 等包管理器自动升级。
- **Agent 支持拓展**: 在 `add-mcp` 与 `add-skill` 环境配置命令中增加了对 Antigravity 和 Gemini Agent 的配置集成支持。

### 🚀 优化与重构 (Refactor)

- **更新命令重命名**: 将原来的更新命令统一规范重命名为 `upgrade` 以保持与包管理器语义一致。
- **UI 优化**: 改善命令行输出，移除了更新提示文本外围的边框以保持样式简洁。

## 0.1.2-beta.2

### 🐛 修复 (Fix)

- **登录流程优化**: 重构 `promptLogin` 函数中的账号密码交互式输入，全面切换为 Promise (async/await) 异步支持机制，提升了终端命令行的交互稳定性。

### 📝 文档 (Docs)

- **补充文档**: 更新完善了项目的 HTML 文档引导页 (`index.html`)。

## 0.1.2-beta.1

### ✨ 新特性 (Feat)

- **MCP 服务配置**: 实现了全新的 `add-mcp` 命令，可用于一键配置和挂载基于 MCP 协议的本地 AI Agent 支持服务（支持 VS Code / Cursor 等配置一键注入）。
- **账号操作支持**: 新增了暴露给 MCP 生态的 `zentao_switch_profile` 工具支持动态切换工作区账户，以及 `zentao_profile` 获取当前认证账号状态的内置工具功能。
- **扩展 Agent 平台**: 工具配置向导 `add-skill` 中兼容加入了面向 **Cherry Studio** 用户端技能集成的指令选项。

### 📝 文档 (Docs)

- **集成指南**: 对说明文档和 SDK Skill 进行了一次结构梳理修订，全面提供了主流 Agent 环境的使用配置指南。
- **静态主页**: 增加了静态分发的主体引导页 `index.html`。

## 0.1.2-beta.0

### ✨ 新特性 (Feat)

- **MCP Server 模块**: 正式加入模型上下文协议（Model Context Protocol）能力引擎代码。通过 `zentao mcp` 暴露标准 MCP stdio 服务，允许 AI Agent 直连禅道系统的所有生态模块。
- **交互式向导式登录**: 重写了命令行认证机制体验，废弃同步 URL 输入改为异步 `readline` 向导模式。

### 🐛 修复 (Fix)

- **Schema 处理**: 调整了传入 MCP 服务时的 API 参数 Schema，强制其类型结构转换为 String Keys 以匹配 JSON Schema 标准。
- **隐式传参支持**: 在 `resolver` 参数解析器中加入了对额外匿名参数的识别与映射兼容逻辑。

### 🚀 优化与重构 (Refactor)

- **指令梳理**: 对系统日志命令 `help` 数据项的输出进行了修正排版和不必要的标记删除操作，独立提取抽离了 CLI 版本获取方法 `getCliVersion`。

### ✅ 测试 (Test)

- **端到端测试**: 为新增的 MCP 模块机制补齐了功能链工具发现集成测试和输入模式的 Schema 边界验证。

## 0.1.1-beta.0

### ✨ 新特性 (Feat)

- **技能辅助生成**: 引入 `add-skill` 全局命令用来为支持各种语境能力的 AI Agents 注入相应的辅助配置文件及指南文本。
- **管道集成模式**: 引入 `--machine-readable` 全局参数用来关闭全部的终端颜色控制与表格排版符输出，供非 TTY 主机自动化流操作兼容使用。
- **命令补全**: 强化所有自动补全 `autocomplete` 辅助脚本以涵盖最新的新增命令分支。

### 🐛 修复 (Fix)

- **异常捕获分析**: 全局增强底层数据层 `ZentaoClient` 拦截并完整暴露抛出含有详细报文状态、执行接口路径的高亮报错跟踪信息。
- **分页栏排版**: 优化底层日志拦截组件在命令行空行渲染的断句换行异常显示粘连。

### 🚀 优化与重构 (Refactor)

- **指令路由规范**: 将散落的基础 CRUD 处理器逻辑抽象层重构成大一统入口解析执行流；调整部分无显示工作区范围参数自动继承的回落错误（追加了对于不合法空值抛出 `E2009` 断言的机制）。

## 0.1.0-beta.0

### ✨ 初始预发布版本 (Initial Pre-release)

- **新项目及命令确立**: 框架主入口确认命名为 `zentao-cli` 发布。
- **元数据编译转化**: 将系统官方提供 `openapi.json` 编译输出到静态命令的数据支持配置仓库（Data registries）。
- **复合鉴权系统**: 支持配置包含 Token 与常规账号密码的双轨组合，附有交互向导与终端用户环境加密隔离的文件持久化验证引擎。
- **自动智能补全**: 原生植入 bash / zsh 的环境变量按 `Tap` 自动探测的高亮补齐代码支持机制。
- **工作区域切换**: 引入了隔离式 `workspace` 集群环境控制组件系统。
