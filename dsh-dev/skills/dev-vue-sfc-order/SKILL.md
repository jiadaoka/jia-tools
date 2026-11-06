---
name: dev-vue-sfc-order
description: "写 .vue 文件时固定三段顺序：template 在最上、script 居中、style 在最后。适用于任何 Vue 2 / Vue 3 项目的单文件组件。当你新建或改写 .vue 文件、往已有组件里加样式块时适用；只改注释或一行文案时不适用。"
metadata:
  layer: ui
  stack: vue
---

# SFC 三段顺序

```vue
<template>
  ...
</template>

<script setup lang="ts">
...
</script>

<style scoped lang="scss">
...
</style>
```

**顺序固定：模板在最上面，脚本中间，样式最后。** 理由只有一个——读一个文件时先想知道它长什么样，其次才是它怎么动，最后才是它怎么好看。倒过来读，每次都要先趟过几百行逻辑才看得见结构。

**不写的段直接省略，不要留空块。** `<style scoped></style>` 这种空壳要删掉：它不表达任何信息，还让人以为这里本来有样式。

**`style` 默认 `scoped`。** 只有一种情况例外：样式要作用到 teleport 出去的节点（`el-dialog`、`el-drawer` 这类挂到 body 上的组件），`scoped` 打不到它们。这时**优先把那部分样式搬进项目的全局样式文件**，不要在组件里写一个不带 `scoped` 的块——不带 `scoped` 的块是全局泄漏，它影响的文件不在这个目录里，出问题时没人会来这里找。

**老文件不批量返工。** 碰到顺序不对的旧文件，顺手改对了它；专门为顺序去翻一堆没动过的文件不值得。
