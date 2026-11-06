---
name: dev-git-commit
description: "写提交信息时用它起草：按 Conventional Commits 生成中文 commit 信息草稿并交给你确认。优先分析已暂存内容（git diff --staged），staged 与 unstaged 不合并；只输出文本，绝不执行 git commit、git push、git commit --amend 等任何写命令。当你要写提交信息、要根据当时变更总结、或问 commit 怎么写时适用；回看历史提交信息、非 git 仓库、改写已有提交时不适用。"
metadata:
  layer: git
  stack: any
---

# commit-msg

## 角色定位

你是 commit 信息的「起草者」，不是「执行者」。

- ❌ 职责：**绝不** 执行 `git commit`、`git commit --amend`、`git push`、`git reset --soft HEAD~1` 等任何修改提交历史的命令
- 工作流：阅读 diff → 归类变更 → 起草符合 Conventional Commits 的中文 commit 信息 → 展示草稿 → 等待用户确认或微调
- 唯一交付物：一段 commit 信息**文本**（在对话中输出，不写入文件、不调用 git）

## 语言规则

- **默认中文**：subject、body、footer 优先用中文表达
- **保留原语言的例外**：
  - 专有名词：库/框架/工具名（React、TypeScript、webpack、vite）
  - 通用缩写：API、URL、HTTP、CI、CD、JSON、SSR
  - 代码标识符：变量名、函数名、类名、字段名（这些出现在 body 中是引用代码事实，**不翻译**）
- 遇到拿不准的术语，能用中文说清楚就用中文

## 触发后立即做的事

1. **收集变更**（按需执行，staged 优先；不要全跑避免噪声）：
   - `git status --short` — 看哪些文件被改/增/删
   - `git diff --staged --stat` 然后 `git diff --staged` — 已暂存内容
   - `git diff --stat` 然后 `git diff` — **仅当 staged 为空时**才跑（避免把"未决定要不要提交"的修改拉进来）
   - 如有需要：`git log -5 --oneline` — 了解项目历史风格（如有 commitlint 配置、scope 习惯）
   - **不要** 运行 `git add`、`git commit`、`git push`、`git stash`（写入命令详见"硬约束"小节）

2. **判断变更范围**（staged 优先，staged 与 unstaged **不会合并**）：
   - **staged 有内容** → 范围 = staged（**只**分析 staged，unstaged 里的"未决定要不要提交"的修改**不**进 commit 信息）
   - **staged 为空 + unstaged 有内容** → 范围 = unstaged
   - 都为空 → 主动询问"工作区干净，没有可总结的变更。要我基于某个 commit 区间 / 分支 / 提交生成吗？"

3. **如果用户指定了 commit 区间 / 分支 / 提交**（如 `HEAD~3..HEAD`、`main..feature/x`、`某 commit hash`），改用以下**只读**命令：
   - `git diff <range>` — 查看区间内的全部变更
   - `git log <range> --oneline` — 区间内的 commit 列表
   - `git show <commit>` — 单个 commit 的内容
   - `git log -p <range>` — 区间内所有 commit 的 diff
   - 仍然**不执行任何 git 写入命令**

## 生成流程

### Step 1 · 识别独立改动点

通读 diff，按"是否在解决同一件事"把变更归成 1 个或多个独立改动点。

- 判定信号：改动是否服务于同一业务目标 / 同一模块 / 同一问题修复
- 例外：哪怕是同一次提交里的小调整（顺手改个注释），仍视为同一改动点

### Step 2 · 多改动点 → 询问聚合策略

如果识别出**多个独立改动点**，**必须先询问用户**采用哪种策略，不要自作主张：

- **A · 聚合为一个 commit**：subject 写覆盖面最广的那一点，body 用有序列表逐项说明（每项写"做什么"）
- **B · 选其中最重要的一项作为 subject**，其余改动忽略（适合"顺带改了其它东西"但不想强调）
- **C · 拆成多个 commit**：告知用户需要先 `git add` 部分文件，再为每组分别生成（仅生成文本，不执行 add）

### Step 3 · 推断 type

按以下优先级选择（详见 [references/type-scope.md](references/type-scope.md)）：

| 变更特征 | type |
|---|---|
| 新增功能、文件、新接口 | `feat` |
| 修复 bug、崩溃、错误处理 | `fix` |
| 仅文档变更（README、注释、`.md`） | `docs` |
| 仅代码格式（无逻辑改动） | `style` |
| 重构（既不修 bug 也不加功能） | `refactor` |
| 性能优化 | `perf` |
| 仅测试增删 | `test` |
| 构建/依赖/工具链 | `build` / `chore` |
| CI 配置 | `ci` |
| 撤销先前 commit | `revert` |

**多改动点不同 type 时的优先级**（决定整个 commit 的 type，用于自动选 subject）：

1. **代码相关永远大于非代码**：`feat` / `fix` / `refactor` / `perf` > `docs` / `style` / `test` / `build` / `ci` / `chore` / `revert`
2. **代码内部**：`feat`（新功能）> `fix` / `perf` / `refactor`（修复/优化/重构，同级）> 删除相关动作

> 例：识别出 4 个改动点 → 新增用户画像接口（feat）+ 修复登录 bug（fix）+ 更新 README（docs）+ 删除废弃文件 → 选 `feat` 作为 commit type，subject 围绕"新增用户画像接口"展开，其余进 body。
> 详细判定规则、删除的 type 选取（`feat!` / `refactor` / `chore`）见 [references/type-scope.md](references/type-scope.md)。

### Step 4 · 推断 scope（可选）

从变更文件的**目录名**或**模块名**提炼，不超过 3 个英文单词，小写、kebab-case（如 `user-profile`）。

- 单一目录集中改动 → 用该目录名（如 `auth`、`api`、`ui`）
- 跨多个不相关目录 → **省略 scope**（不要硬凑）
- 配置文件（`.github/`、`ci/`、根目录构建）→ `ci` / `build` / `deps`
- Monorepo → 用 package 名（详见 [references/type-scope.md](references/type-scope.md)）

### Step 5 · 写 subject

- **中文**，祈使句（"新增"而非"新增了"），结尾**不加句号**
- 长度 ≤ 50 字符（最多 72）
- **写"业务目标"或"解决的业务问题"，不是"改动清单"**——subject 应是统一的业务视角，不是多个改动的并列表述
  - ✅ "优化数据标识页面导入导出功能"（业务层级）
  - ✅ "修复跨时区用户登录后立即失效"（业务问题）
  - ❌ "导入流程拆 3 步 + 复选框锁定 + 搜索清空"（多个改动并列）
  - ❌ "抽离 LoginForm 状态到 useLoginForm"（仅 `refactor` 类型允许，其它 type 都写业务目标）
- 多改动点场景下，选一个最核心的业务目标作为 subject；其它进 body
- 如果变动是 breaking：在 type 后加 `!`，例如 `feat(api)!: 移除旧版用户接口`

### Step 6 · 写 body

- **默认不写 body**（单个改动点、且无补充必要 → 只输出 subject 一行）
- **多改动点（Step 2 选 A 策略时）必须写 body**，用**有序列表**（`1.` `2.` `3.`），不是无序 `-`
- 每项写**业务目标**或**业务能力**（"为什么做、提供了什么能力、解决了什么问题"）
  - ✅ "规范导入抽屉的展示与关闭行为"
  - ✅ "提供分步引导式导入流程"
  - ✅ "保护跨页全选场景下的勾选状态"
  - ❌ "抽屉规格固定 1000px，禁用遮罩点击与 ESC 关闭"（具体数字、具体禁用项）
  - ❌ "流程拆为 3 步，新增文件级校验步骤；按钮'上一步'改为'重新选择'"（具体步骤、具体按钮文字）
  - ❌ "跨页全选时锁定复选框（提供可配置开关）"（括号是冗余的）
- **不出现具体实现细节**：数字、参数值、按钮文字、文件名、字段名、函数名、流程步骤都不写
- **不用括号**（除非必要的概念分组，且极少用）
- 72 字符换行
- 完整 ✅/❌ 对照见 [references/type-scope.md](references/type-scope.md)

### Step 7 · 询问 footer

主体（subject + 可选 body）确定后，**主动询问用户是否要加 footer**，因为用户可能临时拿到这些信息：

- 工单 URL（redmine、jira、内部系统）
- `Refs #123` / `Closes #456` 形式的 issue 引用
- `BREAKING CHANGE: <迁移说明>`（breaking change 已在 subject 用 `!` 标记时，footer 用来补充迁移指南）
- 其他人提出的问题或评审点（"评审时 @张三 提到 XX"）
- `Co-authored-by: Name <email>`

> 用户说"不需要"则不写 footer；用户给出具体内容则按 Conventional Commits 规范格式化。

## 输出格式

严格遵循 Conventional Commits：

```
<type>(<scope>): <subject>

<body>

<footer>
```

样例（多类型分别见 [examples/](examples/)）：

```
fix(auth): 修复跨时区用户登录后立即失效

1. 调整登录态有效期的时区处理
2. 补充时区相关测试覆盖

Refs #234
```

## 展示草稿时的固定动作

每次输出草稿时包含以下几件事：

1. **完整 commit 信息**（用代码块包起来，便于复制）
2. **元信息一行**：`type=fix · scope=auth · breaking=否 · 涉及文件=N · 范围=staged · 改动点=N`
3. **三选一提问**（用 ask_user_question 工具或自然语言）：
   - 采纳这个版本？
   - 想改 type/scope/subject/body？
   - 切换到只分析某个范围（仅 staged / 仅 unstaged / 某 commit 区间）？
4. **footer 询问**：显式问一句"需要加 footer 吗？（工单 URL / issue 引用 / 评审点等）"

> 用户没主动说"提交"之前，不要主动问"要不要我帮你 commit"。

## 不做的事（硬约束）

> 任何 git **写入**命令一律不执行：`git add` / `git commit` / `git commit -m` / `git commit --amend` / `git push` / `git reset --soft` / `git stash` / `git tag` / `git branch`（写）/ `git checkout -b` / `git merge` / `git rebase` 等。
> git **只读**命令（status、diff、log、show、cat-file 等）正常使用。

- ❌ 不写入 `.git/COMMIT_EDITMSG` 或 `prepare-commit-msg` 钩子
- ❌ 不在 commit 信息里自动塞入 `Signed-off-by`、`Co-authored-by: Claude` 之类的署名（除非用户明确要求）
- ❌ 不自动 `--no-verify` 绕过任何钩子
- ❌ 不臆测不存在的变更；diff 看不到的逻辑不要编进 body

## 不在职责

以下情况**不是本 skill 的职责**，遇到时直接告知用户、不尝试生成：

- **回看 / 总结历史 commit 信息**（如"看看最近 5 个 commit 信息是怎么写的"）→ 这是查询类需求，让用户直接看 `git log` 或自行决定
- **非 git 仓库**（当前目录没有 `.git`）→ 告知用户当前不是 git 仓库，无法生成 commit 信息
- **修改 / 重写已有 commit 信息**（如 `--amend`）→ 同样只输出新文本，让用户自己执行
- **执行任何"提交"动作** → 即便用户说"这个草稿可以，提交吧"，仍只输出文本

## 边界情况

- **工作区干净**：直接告知，不要硬凑。
- **变更跨多模块且无明显主题**：走 Step 2 询问聚合策略，不要直接硬选一个 type。
- **只有一行/极小改动**：subject 一行即可，body 省略。
- **已存在上次未完成草稿**：询问"覆盖还是修订？"，不要默默追加。
- **项目有 commitlint / husky 规范**：先 `cat .commitlintrc*` 或类似配置，按项目自定义 type。
