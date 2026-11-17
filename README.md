# jia-tools

我的工具集合。每个子目录是一个独立的 DeepSeek Harness bundle：能单独安装、单独卸载，有自己的 README、自己的测试。

现在是三个，各管一段：

| 目录 | 管什么时候 | 一句话 |
| --- | --- | --- |
| [`dsh-predev/`](dsh-predev/) | 开发之前 | 把想法问到够开工，写成 `PREDEV.md`，需要时做非真原型 |
| [`dsh-dev/`](dsh-dev/) | 写代码时 | 按项目身份装配纪律条款，配 6 条常驻提示与三道门禁 |
| [`dsh-review/`](dsh-review/) | 读代码时 | 范围交给 Open Code Review 判定，判断与报告按自己的规范出；也审自己还没提交的改动 |

`nook/` 是过程材料，不安装。

## 能不能只装一个

能。它们不互相引用，代码、条款、命令里都没有对方的名字——只装一个，它自己就能用。

同时装的时候也接得上，衔接处只有一样东西：**交接物**。`dsh-predev` 产出 `PREDEV.md`（为什么、给谁、做到哪算完），`dsh-dev` 约束动作（怎么写、什么时候能停），`dsh-review` 检查结果（改成了什么样、还差什么）。三者串起来是一条完整的链：想清楚 → 写下去 → 回头看。

同一个坑这三个阶段各掉一次：开发前掉的是**过度设计**（想两周，一行没写），写代码时掉的是**过度松懈**（直接开写，或照着存量代码抄），审查时掉的是**自我恭维**（顺手跑一遍就宣布通过，或者报一堆说不清影响的问题）。

## 共同的形态

- 都是 DSH bundle：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`。
- 都用 `link:` 装进 profile，改代码重启即生效，不必发版。
- 技能正文都是 Markdown，改条款不用改 JS。
- `dsh-dev`、`dsh-review` 自带 `node --test`，断言写在 `test/` 下；`dsh-predev` 没有独立断言文件，用 `scripts/check.mjs` 拿桩 `ctx.skills` 跑一遍 `apply()`。结构问题要在装之前红，不要等下次启动才发现少了一条。
- 互不 import。需要共用就从两处各写一遍，比重构一个共享包便宜。

`dsh-review` 有两处不一样，都是刻意的：

- **它依赖一个外部程序**（`ocr`），但不安装它，也不把它写进 dependencies。找不到就报错并给出安装命令。
- **它有自己的运行时产物**（`<repo>/.review/`），不是纯规则包。

## 安装

```sh
dsh plugin --profile desktop add E:\project\engineering\jia-tools\dsh-predev
dsh plugin --profile desktop add E:\project\engineering\jia-tools\dsh-dev
dsh plugin --profile desktop add E:\project\engineering\jia-tools\dsh-review
```

重启 profile 后生效。卸载把 `add` 换成 `remove`。

`dsh-review` 装之前先确认 `ocr` 在位（它的 README 里有两条安装命令）。没有也能装，只是第一次审查会明确告诉你缺什么。

## 再加一个工具

建一个子目录，照现有三个的骨架：

```
<名字>/
  package.json        # name + dsh.bundle.patch
  cordis.patch.yml    # 一行 insert，id 与插件名
  index.js            # 挂载入口
  prompt.md           # 常驻提示（如果这个工具需要）
  skills/             # 条款（如果这个工具需要）
  test/               # 断言
  README.md           # 它自己的说明
```

`index.js` 里没有 default export：Cordis Loader 直接读命名导出（`name`、`inject`、`apply`）。
