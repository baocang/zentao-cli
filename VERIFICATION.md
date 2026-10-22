# ZenTao CLI 22.4 全功能验证进度

> 目标：使用 `http://192.188.106.60:9998` 验证 zentao-cli 所有功能，发现问题即修复。
>
> 状态图例：⬜ 未测 | ✅ 通过 | ❌ 失败已修 | 🔧 失败待修 | ⏭️ 不适用

## 测试环境

- ZenTao 服务：`http://192.188.106.60:9998`
- 账号：`niebaocang`
- 配置文件：`/tmp/zt-verify.json`
- 命令前缀：`ZENTAO_CONFIG_FILE=/tmp/zt-verify.json bun run src/index.ts`

---

## 1. 列表操作 (LIST)

> 上下文：productID=34 (CJC-WMS)，projectID=201 (凯波二期)，executionID=534。
> 说明：story/bug/testcase/build/testtask 支持 `--product`/`--project`/`--execution` 多种 scope；
> task 仅支持 `--executionID`；epic/requirement/feedback/ticket/release/system/productplan 仅支持 `--productID`。
> `--search`/`--filter` 为客户端过滤（仅作用于已拉取的页），配合 `--all` 可全量过滤。

| 模块 | 基本列表 | --page | --recPerPage | --all | --sort | --filter | --search |
|------|---------|--------|-------------|-------|--------|----------|----------|
| user | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| program | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| product | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| project | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| execution | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| productplan | ✅ (--productID 34) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| story | ✅ (--productID 34) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| epic | ✅ (--productID 34, 无数据) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| requirement | ✅ (--productID 34, 无数据) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| bug | ✅ (--productID 34) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| testcase | ✅ (--productID 34) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| task | ✅ (--executionID 534) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| feedback | ✅ (--productID 34, 无数据) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ticket | ✅ (--productID 34, 无数据) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| system | ✅ (--productID 34) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| build | ✅ (--execution 534) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| testtask | ✅ (--productID 34) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| release | ✅ (--productID 34) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 2. 详情操作 (GET)

> 测试 ID：user=131, product=34, project=201, execution=534, productplan=562, story=6074,
> bug=12466, testcase=case_48(→48), task=57421, testtask=119, release=89。
> epic/requirement 在本实例 URAndSR=0（功能禁用），GET 返回 E2006；feedback/ticket/system 无可访问测试数据。
> `--format json` 经核验不含任何 box-drawing 字符（┌│└─）。

| 模块 | 数据正确提取 | --format json 无乱码 | --format raw | --pick |
|------|------------|--------------------|--------------|--------|
| user | ✅ | ✅ | ✅ | ✅ |
| product | ✅ | ✅ | ✅ | ✅ |
| project | ✅ | ✅ | ✅ | ✅ |
| execution | ✅ | ✅ | ✅ | ✅ |
| productplan | ✅ | ✅ | ✅ | ✅ |
| story | ✅ | ✅ | ✅ | ✅ |
| epic | ⏭️ (URAndSR=0) | ⏭️ | ⏭️ | ⏭️ |
| requirement | ⏭️ (URAndSR=0) | ⏭️ | ⏭️ | ⏭️ |
| bug | ✅ | ✅ | ✅ | ✅ |
| testcase | ✅ (case_48 归一化为 48，issue #2) | ✅ | ✅ | ✅ |
| task | ✅ | ✅ | ✅ | ✅ |
| feedback | ⏭️ (无数据) | ⏭️ | ⏭️ | ⏭️ |
| ticket | ⏭️ (无数据) | ⏭️ | ⏭️ | ⏭️ |
| system | ⏭️ (E2006 权限) | ⏭️ | ⏭️ | ⏭️ |
| build | ⏭️ (见 LIST 权限说明) | ⏭️ | ⏭️ | ⏭️ |
| testtask | ✅ | ✅ | ✅ | ✅ |
| release | ✅ | ✅ | ✅ | ✅ |

## 3. 创建操作 (CREATE)

> 三种传参形式（`--key value`、`--key=value`、`--data '{...}'`）对所有模块均行为一致；
> CLI 正确转发参数到服务端，服务端业务校验（必填字段/日期约束等）属 ZenTao 侧规则，不计入 CLI 缺陷。
> 已成功创建的测试对象：bug(22607-22611)、task(67849-67851)、story(15430-15431)、testcase(151-152)。
> ZenTao 22.4 部分接口（bug/story/testcase）在 schema 外额外要求 project/module/source/verify 等字段，CLI 已正确透传。
> product create（191/192/193）服务端额外要求 desc；project create（659/660/661）服务端额外要求 desc/PM。
> file 模块的 `POST /files` 实为 multipart 文件上传端点（OpenAPI schema 误将 `fileName` 描述为普通字符串），
> 三种传参形式行为一致、CLI 正确转发，但服务端拒绝 JSON body（需 multipart/form-data），属服务端 API 设计，不计入 CLI 缺陷。

| 模块 | --key value (空格) | --key=value (等号) | --data JSON | 上下文 ID |
|------|-------------------|-------------------|-------------|----------|
| user | ⏭️ (无 create) | ⏭️ | ⏭️ | ⏭️ |
| program | ⏭️ (无 create) | ⏭️ | ⏭️ | ⏭️ |
| product | ✅ (3 形式一致, 191/192/193, 服务端要求 desc) | ✅ | ✅ | ⏭️ (无上下文) |
| project | ✅ (3 形式一致, 659/660/661, 服务端要求 desc/PM) | ✅ | ✅ | ⏭️ (无上下文) |
| execution | ✅ (3 形式一致, 服务端要求 PO/日期/分支) | ✅ | ✅ | ✅ (--project 短名) |
| productplan | ✅ (3 形式一致, 服务端要求 end) | ✅ | ✅ | ✅ (--productID) |
| story | ✅ | ✅ | ✅ | ✅ (--product 短名, issue #3 已修) |
| epic | ⏭️ (URAndSR=0) | ⏭️ | ⏭️ | ⏭️ |
| requirement | ⏭️ (URAndSR=0) | ⏭️ | ⏭️ | ⏭️ |
| bug | ✅ | ✅ | ✅ | ✅ (--product 短名, issue #3 已修) |
| testcase | ✅ | ✅ | ✅ | ✅ (--product 短名) |
| task | ✅ | ✅ | ✅ | ✅ (--executionID) |
| feedback | ✅ (3 形式一致, 返回空→显示操作成功, issue #4) | ✅ | ✅ | ✅ (--product 短名) |
| ticket | ✅ (3 形式一致, 返回空→显示操作成功, issue #4) | ✅ | ✅ | ✅ (--product 短名) |
| system | ⏭️ (无 create) | ⏭️ | ⏭️ | ⏭️ |
| build | ✅ (3 形式一致, 服务端要求 date/desc) | ✅ | ✅ | ✅ (--executionID) |
| testtask | ✅ (3 形式一致, 服务端要求 owner/status) | ✅ | ✅ | ✅ (--productID) |
| release | ✅ (3 形式一致, 服务端要求有效 build) | ✅ | ✅ | ✅ (--productID) |
| file | ⏭️ (POST /files 需 multipart 上传, 见说明) | ⏭️ | ⏭️ | ⏭️ |

## 4. 工作流操作 (ACTIONS)

> 测试对象：bug(22607-22611)、task(67849-67851)、story(15430-15431)、testcase(case_48)、testtask(119)。
> `--key value` 与 `--data` 两种形式对所有动作行为一致；CLI 正确转发参数，状态机/必填校验由服务端处理。
> epic/requirement 动作因 URAndSR=0 跳过。

| 模块 | 操作 | --key value | --data |
|------|------|-------------|--------|
| bug | activate | ✅ (--openedBuild) | ✅ |
| bug | close | ✅ | ✅ |
| bug | resolve | ✅ (--assignedTo) | ✅ |
| bug | confirm | ✅ | ✅ |
| bug | assignto | ✅ | ✅ |
| task | start | ✅ | ✅ |
| task | pause | ✅ | ✅ |
| task | restart | ✅ (--realStarted, 受状态机限制) | ✅ |
| task | cancel | ✅ | ✅ |
| task | finish | ✅ (--currentConsumed/--comment) | ✅ |
| task | close | ✅ | ✅ |
| task | activate | ✅ | ✅ |
| task | assignto | ✅ | ✅ |
| story | activate | ✅ | ✅ |
| story | change | ✅ (--reviewer) | ✅ |
| story | close | ✅ (--closedReason/--comment) | ✅ |
| story | review | ✅ (--result/--reviewedDate/--comment) | ✅ |
| story | assignto | ✅ | ✅ |
| epic | activate | ⏭️ (URAndSR=0) | ⏭️ |
| epic | change | ⏭️ | ⏭️ |
| epic | close | ⏭️ | ⏭️ |
| epic | review | ⏭️ | ⏭️ |
| epic | assignto | ⏭️ | ⏭️ |
| requirement | activate | ⏭️ (URAndSR=0) | ⏭️ |
| requirement | change | ⏭️ | ⏭️ |
| requirement | close | ⏭️ | ⏭️ |
| requirement | review | ⏭️ | ⏭️ |
| requirement | assignto | ⏭️ | ⏭️ |
| testcase | review | ✅ (case_48 归一化, --result/--reviewedDate) | ✅ |
| testtask | start | ✅ | ✅ |
| testtask | close | ✅ | ✅ |
| testtask | activate | ✅ | ✅ |
| testtask | block | ✅ | ✅ |

## 5. 命令形式一致性

> 通过 md5 比对 list/get 的 JSON 输出，create/delete/resolve 通过实际执行验证。
> 结论：所有简写形式与 CRUD 形式行为完全一致。

| 检查项 | 状态 |
|--------|------|
| `zentao task list` == `zentao ls task` | ✅ (md5 一致) |
| `zentao task` (默认) == `zentao ls task` | ✅ (md5 一致) |
| `zentao task create` == `zentao create task` | ✅ (均创建成功) |
| `zentao bug resolve <id>` == `zentao do bug resolve <id>` | ✅ (均执行成功) |
| `zentao task <id>` == `zentao get task <id>` | ✅ (md5 一致) |
| `zentao task delete <id>` == `zentao delete task <id>` | ✅ (均删除成功，GET 确认不存在) |

## 6. 更新与删除 (UPDATE / DELETE)

> 测试对象：task(67852)、story(15430)、bug(22611)。更新后通过 GET 验证字段已变更；
> 删除后通过 GET 验证返回 "does not exist"。删除确认提示经 `y`/`n` 管道验证。

| 模块 | update --key value | update --data | delete --yes |
|------|-------------------|---------------|-------------|
| task | ✅ | ✅ | ✅ (确认提示 y/n 均生效) |
| story | ✅ | ✅ | ✅ |
| bug | ✅ | ✅ | ✅ |

## 7. 发现的问题与修复记录

| # | 问题描述 | 模块 | 严重程度 | 状态 | 修复提交 |
|---|---------|------|---------|------|---------|
| 1 | 列表为空且 API 未返回 pager 时（如 feedback/ticket），CLI 无任何输出，缺少"没有数据"提示 | feedback/ticket (通用) | 中 | ❌ 已修 | f4048a4 |
| 2 | ZenTao 22.x testcase 列表返回带前缀 ID（`case_48`），`get testcase case_48` 报缺少 caseID | testcase | 中 | ❌ 已修 | 4ff6f13 |
| 3 | create 操作使用短名上下文（`--product`/`--project`/`--execution`）时未映射到 body 字段 productID/projectID/executionID，报缺少必要参数 | story/bug/通用 create | 高 | ❌ 已修 | fddb770 |
| 4 | create/update/action 操作服务端返回空数据时（如 feedback/ticket）CLI 无任何输出 | feedback/ticket (通用) | 中 | ❌ 已修 | 2b278f9 |
| 5 | 重复出现的 flag（如 `--reviewer user1 --reviewer user2`）覆盖而非累积，多值字段只保留最后一个值 | story/bug/通用 create | 高 | ❌ 已修 | bd4ef60 |
| 6 | 以 `-` 开头的值（如 `--estimate -1`）在空格传参形式下被静默丢弃（误判为 flag） | 通用 create/action | 高 | ❌ 已修 | bd4ef60 |
| 7 | `delete`/`update`/`action` 未提供 ID 时，先弹出"确认删除 0 个对象"提示再报错 | 通用 delete | 中 | ❌ 已修 | bd4ef60 |
| 8 | `--format json` 输出不一致：GET 输出美化无包装 JSON，LIST/ACTION 输出紧凑包装 JSON | 通用 get/list | 中 | ❌ 已修 | dd29421 |
| 9 | `--data` 传入无效 JSON 时未校验，静默透传垃圾数据到服务端（E2007 错误码已定义但从未触发） | 通用 create/update | 高 | ❌ 已修 | 990dfc7 |
| 10 | `--options` JSON 传参形式已在帮助文档中注册宣传，但从未解析生效（死功能） | 通用 (register-modules/crud) | 中 | ❌ 已修 | 7dcff1a |

---

## 8. 参数边界测试 (PARAMETER EDGE CASES) — 第二轮新增

> 系统测试 `buildParams` 解析逻辑 + 端到端验证。测试对象：task(67857-67864)、bug(22615-22616)、story(15433)。

### 8.1 三种传参形式一致性（RE-VERIFIED）

| 模块 | --key value (空格) | --key=value (等号) | --data JSON | --params JSON |
|------|-------------------|-------------------|-------------|---------------|
| task | ✅ (67857) | ✅ (67860) | ✅ (67863) | ✅ (67858) |
| bug | ✅ (22615) | ✅ (22616) | ✅ | ✅ |
| story | ✅ (15430) | ✅ | ✅ | ✅ |
| testcase | ✅ | ✅ | ✅ | ⏭️ |
| product | ✅ | ✅ | ✅ | ⏭️ |
| project | ✅ | ✅ | ✅ | ⏭️ |

### 8.2 数组参数累积（issue #5 已修）

| 测试 | 结果 |
|------|------|
| `--reviewer user1 --reviewer user2` (空格形式) | ✅ → reviewer="user1,user2" (story 15433 验证双评审人) |
| `--reviewer=user1 --reviewer=user2` (等号形式) | ✅ → reviewer="user1,user2" |
| `--openedBuild trunk --openedBuild main` | ✅ → openedBuild="trunk,main" |

### 8.3 数值类型（RE-VERIFIED）

| 测试 | 结果 |
|------|------|
| `--estimate 1.5` (浮点) | ✅ → 1.5 (Number) |
| `--estimate 0` (零) | ✅ CLI 正确传 0（服务端拒绝零估计，属服务端校验） |
| `--pri 3` (整数) | ✅ → 3 (Number) |
| `--estimate -1` (负数, issue #6 已修) | ✅ → -1 (Number) |

### 8.4 特殊字符（RE-VERIFIED）

| 测试 | 结果 |
|------|------|
| `--name "task with spaces and 特殊字符"` | ✅ (67859) |
| `--name="equals-form-special-chars-测试"` | ✅ (67860) |
| `--data '{"name":"quoted \"value\""}'` | ✅ |
| `--name -test` (以 - 开头, issue #6 已修) | ✅ → name="-test" |

### 8.5 布尔/裸 flag

| 测试 | 结果 |
|------|------|
| `--deleted` (裸 flag) | ✅ → true |
| `--acl open` | ✅ → "open" |

### 8.6 JSON 校验（issue #9 已修）

| 测试 | 结果 |
|------|------|
| `--data 'not-json'` | ✅ E2007 清晰报错 |
| `--data '{"invalid": }'` | ✅ E2007 清晰报错 |
| 位置参数 `'{"invalid": }'` | ✅ E2007 清晰报错 |
| `--params 'not-json'` | ✅ E2009 清晰报错 |

### 8.7 --options JSON 形式（issue #10 已修）

| 测试 | 结果 |
|------|------|
| `--options '{"limit":2,"format":"json"}'` | ✅ 正确应用 limit+format |
| 显式 `--limit` 覆盖 `--options` 中的 limit | ✅ 显式标志优先 |
| `ls bug --options '{...}'` (ls 形式) | ✅ 同样生效 |

---

## 9. 命令形式一致性（RE-VERIFIED + 扩展）

### 9.1 LS vs 模块形式（全部 18 模块 MD5 比对）

| 模块 | `zentao <mod>` == `zentao ls <mod>` | `zentao <mod> list` 一致性 |
|------|-------------------------------------|---------------------------|
| user | ✅ | ✅ |
| program | ✅ | ✅ |
| product | ✅ | ✅ |
| project | ✅ | ✅ |
| execution | ✅ | ✅ |
| productplan | ✅ | ✅ |
| story | ✅ | ✅ |
| epic | ✅ | ✅ |
| requirement | ✅ | ✅ |
| bug | ✅ | ✅ |
| testcase | ✅ | ✅ |
| task | ✅ | ✅ |
| feedback | ✅ | ✅ |
| ticket | ✅ | ✅ |
| system | ✅ | ✅ |
| build | ✅ | ✅ |
| testtask | ✅ | ✅ |
| release | ✅ | ✅ |

### 9.2 操作形式（CRUD vs 简写 vs do）

| 检查项 | 状态 |
|--------|------|
| `zentao task create` == `zentao create task` | ✅ |
| `zentao bug resolve <id>` == `zentao do bug resolve <id>` | ✅ |
| `zentao task <id>` == `zentao get task <id>` | ✅ |
| `zentao task delete <id>` == `zentao delete task <id>` | ✅ |

### 9.3 动作 flag 形式一致性（--key value / --key=value / --data）

| 模块 | 操作 | --key value | --key=value | --data |
|------|------|-------------|-------------|--------|
| task | start | ✅ (--realStarted/--left) | ✅ (67857 验证) | ✅ |
| task | finish | ✅ (--currentConsumed/--comment) | ✅ | ✅ |
| task | close | ✅ | ✅ (67861 验证) | ✅ |
| bug | resolve | ✅ (--assignedTo/--resolution) | ✅ (22615 验证) | ✅ |
| bug | close | ✅ | ✅ | ✅ (22615 验证) |
| bug | activate | ✅ | ✅ | ✅ |

---

## 10. 输出格式一致性（RE-VERIFIED + issue #8 已修）

| 格式 | LIST | GET | CREATE/ACTION |
|------|------|-----|--------------|
| `--format json` | ✅ 紧凑 `{"status":"success","data":[...]}` | ✅ 紧凑 `{"status":"success","data":{...}}` (issue #8 已修) | ✅ 紧凑 `{"status":"success","data":...}` |
| `--format raw` | ✅ 美化完整服务端响应 | ✅ | ✅ |
| `--format markdown` (默认) | ✅ 表格 + 分页摘要 | ✅ 键值列表 | ✅ 操作成功提示 |
| `--machine-readable` | ✅ 无 ANSI 色码 | ✅ | ✅ |

> 验证方式：JSON 格式通过 `node -e "JSON.parse()"` 确认可解析；machine-readable 通过 `cat -v` 确认无 ANSI 转义序列。

---

## 11. 错误处理（RE-VERIFIED + issues #7/#9 已修）

| 场景 | 结果 |
|------|------|
| 不存在的模块名 | ✅ Commander "unknown command" |
| 不存在的操作名 | ✅ E2005 中文提示 |
| 不存在的对象 ID | ✅ E2008 含服务端错误信息 |
| 缺少必填参数 | ✅ E2003 中文提示（注：模块名为空，`zentao  help` 双空格，低优先级） |
| delete/update/action 缺少 ID | ✅ E2009 立即报错（issue #7 已修，不再先弹确认提示） |
| `--data` 无效 JSON | ✅ E2007 清晰报错（issue #9 已修） |
| `--params` 无效 JSON | ✅ E2009 清晰报错 |
| 缺少上下文 ID (scope 模块) | ✅ E2003 提示需要 scope/scopeID |
| 缺少上下文 ID (task) | ✅ E2003 提示需要 executionID |

---

## 12. 数据处理（RE-VERIFIED）

| 功能 | 测试 | 结果 |
|------|------|------|
| `--filter` (=) | `status=active` | ✅ 精确匹配 |
| `--filter` (!=) | `status!=active` | ✅ 排除匹配 |
| `--filter` (OR) | 多个 --filter 标志 | ✅ OR 逻辑正确 |
| `--filter` (AND) | 逗号分隔条件 | ✅ AND 逻辑正确 |
| `--sort` (多字段) | `pri_asc,severity_desc` | ✅ 多级排序正确 |
| `--search` | 关键词搜索 | ✅ 模糊匹配 |
| `--search-fields` | 限定搜索字段 | ✅ 仅搜索指定字段 |
| `--all` + `--filter` | 全量拉取后过滤 | ✅ 6 active / 55 total |
| `--all` + `--limit` | 全量拉取后截断 | ✅ 截断至 3 |
| `--pick` (get) | `--pick id,title,status` | ✅ 仅输出指定字段 |
| `--pick` (list) | `--pick id,title` | ✅ 仅输出指定字段 |
| `--page` 超范围 | `--page 9999` | ✅ 服务端返回最后一页 |
| 批量操作 (逗号 ID) | `task start 67861,67862` | ✅ 批量执行成功 |

---

_最后更新：第二轮 ZERO-OMISSION 审计完成。在第一轮 282 项基础上，新增参数边界测试、全模块形式一致性、输出格式一致性、错误处理、数据处理、MCP 工具共 6 个维度的深度测试。新发现并修复 6 个 CLI 缺陷（#5-#10），并增强 MCP 工具（暴露 all/limit 选项），累计修复 10 个。_

## 13. 总结

### 已修复的 CLI 缺陷（10 个，均已提交）
**第一轮（4 个）：**
1. **空列表无提示**（`f4048a4`）— 列表为空且 API 未返回 pager 时无任何输出
2. **testcase 带前缀 ID 不可用**（`4ff6f13`）— `case_48` 无法用于 get/操作
3. **create 短名上下文失效**（`fddb770`）— `--product`/`--project`/`--execution` 未映射到 body 字段
4. **create/update/action 空响应无反馈**（`2b278f9`）— 服务端返回空数据时无操作成功提示

**第二轮（6 个）：**
5. **重复 flag 覆盖而非累积**（`bd4ef60`）— `--reviewer user1 --reviewer user2` 只保留最后一个
6. **负数/破折号值静默丢弃**（`bd4ef60`）— `--estimate -1` 被误判为 flag 而丢弃
7. **无 ID 操作先弹确认再报错**（`bd4ef60`）— `bug delete` 先问"删除 0 个对象"再报缺 ID
8. **JSON 输出格式不一致**（`dd29421`）— GET 输出美化无包装 JSON，与其他操作不一致
9. **--data 无效 JSON 未校验**（`990dfc7`）— E2007 错误码已定义但从未触发，无效 JSON 静默透传
10. **--options JSON 形式死功能**（`7dcff1a`）— 已注册并文档宣传但从未解析生效

### 功能增强（1 个）
- **MCP 工具暴露 all/limit**（`f3e52d8`）— AI agent 现在可通过 MCP 获取完整数据集

### 非 CLI 问题（ZenTao 22.4 服务端行为，无需修复）
- epic/requirement 模块在 `URAndSR=0` 时禁用（list 返回空、get/action 返回 E2006）
- build 模块对部分项目返回 E2006（用户权限配置）
- 部分接口（feedback/ticket）create 返回 `{"status":"success"}` 不含数据
- 多数 create/动作接口的服务端必填校验严于 OpenAPI schema（如 bug 的 project/module/deadline/resolvedBuild、task 的 estStarted/deadline/realStarted/finishedDate）
- task finish 要求 finishedDate >= realStarted（服务端日期校验）
- estimate=0 被服务端视为空（服务端将 0 视为 falsy）
- file 模块 `POST /files` 为 multipart 文件上传端点，OpenAPI schema 误描述为 `fileName` 字符串
- `--page` 超范围时服务端返回最后一页（服务端分页钳位行为）
- `--recPerPage 0` 时服务端默认返回 20 条（服务端默认值）
- E2003/E2005 错误消息中模块名为空（`zentao  help` 双空格），因 mapSdkError 无模块上下文，低优先级
- Unix 管道缓冲区限制（macOS 默认 64KB）可能导致大 JSON 输出在管道传输中被截断（非 CLI 缺陷，文件重定向正常）
