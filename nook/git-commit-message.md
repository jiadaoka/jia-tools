# Git 提交消息规范

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

## 提交消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 必需部分

#### Type (类型)

提交的类型必须是以下之一：

- **feat**: 新功能 (feature)
- **fix**: 修复 bug
- **docs**: 仅文档更改
- **style**: 不影响代码含义的更改（空格、格式化、缺少分号等）
- **refactor**: 既不修复 bug 也不添加功能的代码更改
- **perf**: 提高性能的代码更改
- **test**: 添加缺失的测试或更正现有测试
- **build**: 影响构建系统或外部依赖的更改（示例范围：webpack, npm, vite）
- **ci**: 对 CI 配置文件和脚本的更改（示例范围：GitHub Actions, GitLab CI）
- **chore**: 其他不修改 src 或测试文件的更改
- **revert**: 回退之前的提交

#### Subject (主题)

- 使用简洁的语言描述本次提交的更改
- 不超过 50 个字符
- **优先使用中文**，只有专有名词、英文缩写等无法翻译的内容才使用英文
- 首字母小写
- 结尾不加句号

### 可选部分

#### Scope (范围)

用于说明提交影响的范围，例如：

- **component**: 组件相关
- **api**: API 相关
- **router**: 路由相关
- **store**: 状态管理相关
- **utils**: 工具函数相关
- **styles**: 样式相关
- **deps**: 依赖项相关

#### Body (正文)

正文是可选的。**判断标准**：如果主题（subject）能够清晰完整地描述本次提交的所有变更，则无需添加正文。

需要添加正文的情况：

- 一次提交包含多个独立的变更点
- 变更是为了修复某个问题，需要说明背景
- 变更涉及多方影响，需要说明原因
- 存在 Breaking Changes 需要说明

> **重要**：一次提交只能有一个 header `type(scope): subject`，多个变更点都应在 body 部分列出，不拆分成多个提交。

正文编写要求：

- 使用列表格式，配合序号 `1. `, `2. `
- 简洁描述每个变更点，避免长篇论述
- 重点说明”是什么”和”为什么”

#### Footer (页脚)

- 用于关闭 Issue 或描述破坏性变更
- Breaking Changes 必须在页脚中以 `BREAKING CHANGE:` 开头
- 关闭 Issue 使用 `Closes #issue号`
- **重要**：如果没有需要关闭的 Issue，也没有破坏性变更，则不应生成 Footer 部分

## 示例

### feat - 新功能

单个变更点：

```
feat(search): 添加文章搜索功能
```

涉及多个变更点：

```
feat(search): 添加文章搜索功能

1. 新增搜索组件，支持关键字匹配
2. 支持按分类、时间筛选结果
3. 搜索历史本地缓存
```

关闭 Issue：

```
feat(article): 添加文章分类功能

1. 新增分类管理模块
2. 支持多级分类结构

Closes [#123](url)
```

### fix - 修复 bug

单个问题：

```
fix(login): 修复登录状态未持久化的问题
```

涉及多个修复点：

```
fix(order): 修复订单支付成功后状态未更新的问题

1. 问题原因：回调处理逻辑缺少错误捕获
2. 修复方案：添加 try-catch 并增加重试机制
3. 影响范围：仅影响异步支付通道

Closes #456
```

### refactor - 重构

```
refactor(utils): 优化文件上传工具函数
```

### perf - 性能优化

```
perf(list): 优化文章列表渲染性能

1. 使用虚拟滚动替代全量渲染
2. 图片懒加载减少首屏请求
```

### docs - 文档

```
docs(readme): 更新项目安装文档
```

### style - 样式

```
style(component): 统一组件代码格式
```

### test - 测试

```
test(api): 添加文章 API 单元测试
```

### build - 构建

```
build(deps): 升级 Vue 到 3.4.0
```

### ci - CI 配置

```
ci: 添加自动部署流程
```

### chore - 杂项

```
chore: 更新 .gitignore 配置
```

### 破坏性变更

```
feat(api): 重构用户认证 API

1. 统一认证接口为 RESTful 风格
2. 新增 token 刷新机制
3. 移除旧版 session 模式

BREAKING CHANGE: 认证接口从 /api/auth 迁移到 /api/v2/auth，
客户端需要更新 API 端点并处理新的 token 机制。
```

### 提交类型速查

| 类型     | 使用场景             | 示例                   |
| -------- | -------------------- | ---------------------- |
| feat     | 新增功能             | `feat(模块): 描述`     |
| fix      | 修复 bug             | `fix(模块): 描述`      |
| refactor | 重构（非功能性变更） | `refactor(模块): 描述` |
| perf     | 性能优化             | `perf(模块): 描述`     |
| docs     | 文档更新             | `docs(模块): 描述`     |
| style    | 代码格式调整         | `style(模块): 描述`    |
| test     | 测试相关             | `test(模块): 描述`     |
| build    | 构建/依赖变更        | `build(模块): 描述`    |
| ci       | CI/CD 配置           | `ci: 描述`             |
| chore    | 其他杂项             | `chore: 描述`          |

## 注意事项

1. **每次提交只做一件事**：如果一次更改涉及多个不相关的修改，应该拆分成多个提交
2. **一个提交一个 header**：每个提交只能有一个 `type(scope): subject`，多个变更点在 body 中列出
3. **提交信息要清晰**：让其他开发者能够快速理解这次提交的目的
4. **遵循团队约定**：如果团队有特殊的提交规范，以团队约定为准
5. **及时提交**：完成一个功能点或修复一个问题后立即提交，不要积累太多更改

## 工具支持

推荐使用以下工具来辅助编写符合规范的提交消息：

- **Commitizen**: 交互式提交工具
- **commitlint**: 提交消息校验工具
- **husky**: Git hooks 工具，配合 commitlint 使用

## 参考资源

- [Conventional Commits 官方文档](https://www.conventionalcommits.org/)
- [Angular 提交规范](https://github.com/angular/angular/blob/master/CONTRIBUTING.md#commit)
