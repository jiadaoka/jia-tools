# dsh-review

代码审查的纪律。范围由 [Open Code Review](https://github.com/alibaba/open-code-review)（OCR）判定，
判断与报告按本包规范产出。

和 `dsh-dev` 的分工按动作分：`dsh-dev` 管**写代码时**怎么做，`dsh-review` 管**读代码时**怎么判——包括读别人提交的范围，也包括读自己刚写完、还没提交的改动。

## 它不安装任何东西

`ocr` 是本包的外部工具，不是依赖：不下载、不安装、不联网。每次调用时按顺序去找，找到就用。

| 顺序 | 来源 |
|---|---|
| 1 | 配置项 `ocrPath`（可指可执行文件，也可指安装目录） |
| 2 | 环境变量 `DSH_REVIEW_OCR` |
| 3 | `<DSH_HOME>/dsh-review/ocr` |
| 4 | `<DSH_HOME>/open-code-review`（`dsh-open-code-review` 装的那份，只读复用，不重复下载） |
| 5 | npm 全局包目录 |
| 6 | `PATH` |

装一条即可：

```sh
npm install --prefix "%USERPROFILE%\.dsh\open-code-review" @alibaba-group/open-code-review
npm install -g @alibaba-group/open-code-review
```

装完**不需要重启**：解析在每次调用时发生，不在挂载时发生。版本缓存按可执行文件的 mtime 与大小失效，所以原地覆盖升级也会重新读。换版本也不必改代码，`ocrPath` 指过去就行。

## 配置

默认值全在代码里，`cordis.patch.yml` 不配也能用。要覆盖时才展开：

```yaml
- id: review-discipline
  config:
    ocrPath: D:\tools\opencodereview.exe
    timeoutMs: 180000
```

| 项 | 默认 | 说明 |
|---|---|---|
| `ocrPath` | `""` | 显式指定，优先级最高 |
| `timeoutMs` | `180000` | 单次调用上限。大仓库首次解析会慢 |

环境变量 `DSH_REVIEW_OCR`、`DSH_REVIEW_TIMEOUT_MS` 等价，用于「不想改 profile、只想临时换一个」。

## 两个工具

| 工具 | 干什么 |
|---|---|
| `review_scope` | 哪些改动文件可审、哪些被排除及原因、取 diff 用哪条命令。同时把清单落到 `<repo>/.review/<单元>/files.txt` |
| `review_rules` | 这批文件适用哪些规则，按规则正文分组，共用同一规则的文件只出现一次 |

工具不调模型，不需要 API Key：`ocr delegate` 只做「选文件、选规则」这两件确定性的事，判断由你（模型）做。

## 六条技能

| 技能 | 管什么 |
|---|---|
| `review-scope` | 审什么：范围不由自己猜、全量重审、存量不审、不越界 |
| `review-evidence` | 怎么判：定位到行、贴关键代码、影响落到后果、说不清就不报 |
| `review-report` | 怎么落：五档严重度、固定字段、覆盖对账、裁定表 |
| `review-recheck` | 复审：重取范围、不继承上轮结论、修复补丁同等审 |
| `review-self` | 审自己写的：判据不放宽、先审没把握处、三种自我背书、未证明要写出来 |
| `review-dependency` | 审依赖改动：锁文件对账、实际装成的版本、漏洞二分、第二套同类能力、传递依赖与删除残留 |

前四条按流程排（审什么 → 怎么判 → 怎么落 → 怎么复审），后两条按**对象**排：一条管自己写的代码，一条管依赖类改动。两者可以与前四条叠加使用。

报告骨架在 `skills/review-report/references/report-template.md`，按需读取，不占常驻上下文。

## 产物落位

```
<repo>/.review/<单元>/
  files.txt      review_scope 落的范围清单，覆盖表必须与它逐行对应
  progress.md    >15 个文件时的「已审 / 待审」
  report.md      报告；多轮时为 <单元>_R<n>_<yyyyMMddHHmm>.md
```

单元名是 `LOCAL-<仓库名>-<时间戳>`。`.review/` 应该进 `.gitignore`——它是审查产物，不是代码。

## 三级降级

| 状态 | 行为 |
|---|---|
| ocr 可用 | 完整：范围 + 规则 + 报告 |
| ocr 不可用 | `review_scope` 直接报「找不到／版本太旧」，附找过的路径与安装命令 |
| 非 git 仓库 | `ocr` 自己报错，工具把原文透出，不包装成「解析失败」 |

没有 ocr 时**不做 git 兜底**：范围是审查的契约，用两套来源判定范围会让「审了什么」变得不可追溯。
宁可明确报错，也不给一份来源不同的清单。

## 测试

```sh
node --test                     # 路径解析、argv、JSON 解析、覆盖对账、装配、结构
node scripts/verify.mjs <仓库>  # 端到端：真实 ocr → 真实清单 → 对账，含一次反向验证
```

断言总数不写在这里：它每加一条就得改一次，改漏了就成了假承诺。跑一遍输出的末行就是真数。

`verify.mjs` 会在目标仓库写 `.review/LOCAL-<名>-verify/`，跑完可以删。

## 一个踩过的坑：不能 import `@deepseek-ai/*`

本包是用 `link:` 装进 profile 的，插件模块的 realpath 在 `jia-tools/` 下，Node 从那里
向上找 `node_modules` 找不到宿主那套 SDK——第一次装进 profile 时就是
`review-discipline (dsh-review): failed to import`。

所以工具定义是自足的 JSON Schema（`tools.register()` 要的就是这份形状），参数与输出的
schema 手写，不经过 `defineTool` 转换。`dsh-dev` 不 import 任何 SDK 也是同一个原因。

## 这个版本没做的

- **自动下载 ocr**。插件零网络、零依赖是刻意的：`link:` 安装下 `optionalDependencies` 不生效，
  跑 `npm install` 又属于隐式副作用（和 `dsh-dev` 的「装依赖由开发者发起」冲突）。真要自动化再加。
- **审查后自动修**。审查只读，修复是另一步；改完必须重取范围重审，否则报告说的是旧代码。
- **覆盖率对账做成工具**。现在是纯函数 + 技能要求「数一遍」。做成工具要解析自己的报告格式，
  等报告格式稳定几轮之后再说。
- **多仓联合**。当前一次审一个仓库；`files.txt` 已预留 `仓库\t路径` 两列格式。
