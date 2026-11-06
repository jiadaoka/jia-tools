# Type 与 Scope 推断参考

## Type 与 type 对应表

> 本表只做"变更特征 → type"的对应映射，**不表达优先级**。多改动点不同 type 时的优先级见下一节"多改动点不同 type 的优先级"。

| type | 适用场景 | 关键信号 |
|---|---|---|
| `feat` | 新增功能、文件、新接口 | 新文件 + 新 export、新路由、新组件、`add:` 类的导出、`feature/` 分支 |
| `fix` | 修复 bug、崩溃、错误处理 | 改动里有 `if`、`catch`、错误码、空值兜底；`bugfix`、`hotfix` 分支名；issue 标题含「修复」「崩溃」「不生效」 |
| `docs` | 仅文档变更 | 改 `.md`、`.txt`、注释、JSDoc；**没有** 代码逻辑改动 |
| `style` | 仅代码格式 | 仅 prettier/eslint 自动改、空白、缩进、引号 |
| `refactor` | 重构 | 仅改组织/命名/抽函数，无行为变化；`refactor/` 分支 |
| `perf` | 性能优化 | `useMemo`、缓存、索引、`O(n²)→O(n)`、懒加载 |
| `test` | 仅测试增删 | 改 `*.test.*`、`*.spec.*`、`__tests__/`、`cypress/` |
| `build` | 构建系统 | `package.json` scripts、`webpack.config.*`、`vite.config.*`、`tsconfig.*` |
| `ci` | CI 配置 | `.github/`、`.gitlab-ci.yml`、`Jenkinsfile`、`circle.yml` |
| `chore` | 杂项 | 改 `.gitignore`、`.editorconfig`、目录结构微调、依赖升级 |
| `revert` | 撤销 | commit 信息里有 `This reverts commit <hash>.` |

### 多改动点不同 type 的优先级

> 适用场景：识别出多个独立改动点且对应不同 type，需要决定整个 commit 用哪个 type（Step 2 选 A 或 B 时自动选 subject 用）。

**第一层 · 代码相关永远大于非代码**：

`feat` / `fix` / `refactor` / `perf` > `docs` / `style` / `test` / `build` / `ci` / `chore` / `revert`

**第二层 · 代码内部优先级**（高到低）：

| 档位 | type | 说明 |
|---|---|---|
| 最高 | `feat` | 新功能 |
| 中 | `fix` / `perf` / `refactor` | 修复、性能优化、重构（同级） |
| 最低 | 删除相关动作 | 通常以 `feat!` / `refactor` / `chore` 形式提交，但在冲突时优先级最低 |

**示例**：识别出 4 个改动点：
- 新增用户画像接口（feat）
- 修复登录时区 bug（fix）
- 更新 README（docs）
- 删除废弃工具函数（refactor/feat）

→ 第一层排除 docs → 第二层 `feat` 最高 → 整个 commit type 选 `feat`，subject 围绕"新增用户画像接口"，其余进 body。

> "删除"在 Conventional Commits 里没有专属 type，按意图选 `feat!`（废弃 API）/ `refactor`（清理代码）/ `chore`（删无用文件）。在冲突判断时统一视作"最低档"。

### 其它冲突场景

- **重构顺手修 bug** → 在 subject/body 明确说明"重构 X，修复 Y"，type 选 `fix`（bug 修复业务影响更大）
- **同一文件改 bug + 加功能** → 按"多改动点不同 type"规则，`feat` 优先
- **新增功能包含测试** → `feat`；测试如果独立提交再单独 `test`
- **依赖升级**：
  - 主版本（`2.x` → `3.x`）→ `feat` 或 `fix`（视 changelog）
  - 次版本/补丁 → `chore(deps):`

## Scope 推断规则

### 从变更路径推断

- 单一目录：`src/auth/login.ts` + `src/auth/register.ts` → `auth`
- 多个子模块但同顶层：`src/components/Button/*` + `src/components/Modal/*` → `components`
- 跨多个不相关顶层 → **省略 scope**（写 `feat:` 不带括号）

### 项目级约定

- 配置文件 → 固定 `build` / `ci` / `deps`
- 国际化 → `i18n`
- 依赖 → `deps`
- 类型定义 → `types`
- 数据库迁移 → `db` 或 `migration`
- **Monorepo** → scope 用 package 名（如 `pkg-name` 或 `@scope/pkg-name`），从变更文件路径的最近 package 目录推断

### 注意事项

- scope 用**小写英文**，kebab-case（如 `user-profile` 而非 `userProfile`）
- 长度不超过 3 个英文单词
- 不要把 scope 写成完整的模块路径（错例：`feat(src/components/auth/login.ts):`）

## Subject 写法

- ✅ "新增 用户登录接口"
- ✅ "修复 跨时区用户登录后立即失效"
- ❌ "新增了用户登录接口"（带「了」不简洁）
- ❌ "新增用户登录接口。"（不加句号）
- ❌ "user login"（应用中文）
- 50 字符以内为佳；超过 72 字符就要拆或精简

### 语言规则

详见 [SKILL.md 的"语言规则"小节](../SKILL.md)。本节仅列补充：常用术语翻译例子 —— `token` → "登录态"、`rendering` → "渲染"、`commit` → "提交"（必要时仍可保留原文）。

## Body 写法

- **默认不写 body**（单个改动点、且无补充必要）
- **多改动点必须写 body**，用**有序列表**（`1.` `2.` `3.`），不用无序 `-`
- 内容是「**做什么**」（业务目标、对外变化），不是「**怎么改的**」
- **不出现具体修改实例**：文件路径、行数、字段名、函数名都不写
- 概括代码事实时用"新增 XX 能力"、"调整 XX 处理"、"减少 XX 耗时"等业务语言

### 对照

#### subject：业务目标 vs 改动清单

| 写法 | 是否合适 | 原因 |
|---|---|---|
| 优化数据标识页面导入导出功能 | ✅ | 业务层级，统一目标 |
| 修复跨时区用户登录后立即失效 | ✅ | 业务问题 |
| 提升列表组件渲染性能 | ✅ | 业务能力 |
| 导入流程拆 3 步 + 复选框锁定 + 搜索清空 | ❌ | 多个改动并列（"改动清单"） |
| 抽离 LoginForm 状态到 useLoginForm | ❌ | 仅 `refactor` 允许；其它 type 写业务目标 |

#### body：业务能力 vs 具体实现

| 写法 | 是否合适 | 原因 |
|---|---|---|
| 1. 提供用户画像数据查询能力 | ✅ | 业务能力 |
| 1. 规范导入抽屉的展示与关闭行为 | ✅ | 业务能力 |
| 1. 联动搜索条件与勾选状态 | ✅ | 业务能力 |
| 1. 新增 src/auth/useLoginForm.ts | ❌ | 文件路径是具体实现 |
| 1. 行数从 280 减至 130 | ❌ | 数字 + 怎么改的 |
| 1. 包含 lastActiveAt、preferences 字段 | ❌ | 字段名是具体实现 |
| 1. 抽屉规格固定 1000px，禁用遮罩点击与 ESC 关闭 | ❌ | 具体数字、具体禁用项 |
| 1. 跨页全选时锁定复选框（提供可配置开关） | ❌ | 括号是冗余的 |
| 1. 按钮"上一步"改为"重新选择" | ❌ | 具体按钮文字 |

## 多改动点的处理

> 详见 [SKILL.md Step 2](../SKILL.md)。

## Footer 模板

```text
Refs #123
Closes #456
BREAKING CHANGE: <迁移说明>
Co-authored-by: Name <name@example.com>
Reviewed-by: Name <name@example.com>
```

> footer 块之间空一行；多 footer 按 `Refs` → `Closes` → `BREAKING CHANGE` → `Co-authored-by` 顺序。
> footer 内容由用户在生成草稿后主动提供（工单 URL、issue 引用、评审点等），不要自动生成。
