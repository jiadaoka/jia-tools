# jia-tools

我的工具集合。每个子目录是一个独立的 DeepSeek Harness bundle：能单独安装、单独卸载，有自己的 README、自己的测试。

现在是两个，各管一段：

| 目录 | 管什么时候 | 一句话 |
| --- | --- | --- |
| [`dsh-predev/`](dsh-predev/) | 开发之前 | 把想法问到够开工，写成 `PREDEV.md`，需要时做非真原型 |
| [`dsh-dev/`](dsh-dev/) | 开发时 | 按项目身份装配纪律条款，配 6 条常驻提示与两个门禁 |

`草稿/` 是过程材料，不安装。

## 两个能不能只装一个

能。它们不互相引用，代码、条款、命令里都没有对方的名字——只装一个，它自己就能用。

同时装的时候它们接得上，衔接处只有一样东西：**决定**。`dsh-predev` 产出 `PREDEV.md`（为什么、给谁、做到哪算完），`dsh-dev` 约束动作（怎么写、什么时候能停）。前者写完就可以不再动，后者的条款会一直跟着代码长。

同一个坑这两个阶段各掉一次：开发前掉的是**过度设计**（想两周，一行没写），开发时掉的是**过度松懈**（直接开写，或照着存量代码抄）。一个限制提问预算，一个把踩过的坑钉在相关项目里。

## 共同的形态

- 都是 DSH bundle：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`。
- 都用 `link:` 装进 profile，改代码重启即生效，不必发版。
- 技能正文都是 Markdown，改条款不用改 JS。
- 都自带 `node --test`，断言写在 `test/` 下——结构问题要在装之前红，不要等下次启动才发现少了一条。
- 互不 import。需要共用就从两处各写一遍，比重构一个共享包便宜。

## 安装

```sh
dsh plugin --profile desktop add I:\project\jia-tools\dsh-predev
dsh plugin --profile desktop add I:\project\jia-tools\dsh-dev
```

重启 profile 后生效。卸载把 `add` 换成 `remove`。

## 再加一个工具

建一个子目录，照现有两个的骨架：

```
<名字>/
  package.json        # name + dsh.bundle.patch
  cordis.patch.yml    # 一行 insert，id 与插件名
  index.js            # 挂载入口
  skills/             # 条款（如果这个工具需要）
  test/               # 断言
  README.md           # 它自己的说明
```

`index.js` 里没有 default export：Cordis Loader 直接读命名导出（`name`、`inject`、`apply`）。
