---
name: dev-vue-container-split
description: 容器与业务分离：业务组件和容器是两个文件、同一个目录，对外只有容器一个入口；开关状态与挂载时机归容器，业务组件按它实际是什么命名。写弹窗、抽屉、页面内联面板这类带开关的容器时适用；纯静态展示、无开关状态的组件不适用。
metadata:
  layer: ui
  stack: vue
---

# 容器与业务分离

**框是框，业务是业务。**

```
BookDetail/            目录名就是业务组件的名字
├─ BookDetail.vue      业务层：它自己是什么，就叫什么
└─ Dialog.vue          容器：只认识「开关」，不认识业务（或 Drawer.vue，二者选一）
```

## 1 命名

业务组件按它**实际是什么**命名：`BookDetail`、`UserForm`、`ImportWizard`。

不要叫 `Content`、`Body`、`Inner`、`Wrapper`——这类名字不带信息，看一眼不知道里面是什么，而且第二个容器一出现就撞名。

## 2 对外只有一个入口

目录里两个文件，别的地方只 import 容器。业务组件由容器挂载，不直接被外部引用。

这样换壳（Dialog 换 Drawer、弹窗换整页）不需要动任何调用方。

## 3 开关归容器

- 开关状态（`visible` / `opened`）与 `open()` / `close()` 由容器持有，经 `defineExpose` 对外暴露。
- 业务层不知道「自己是被弹出来的」——它只接收自己的业务参数。
- 业务在打开之后才挂载（`v-if="opened"`）：关闭即销毁，每次打开都是干净状态，不需要手写 reset，也就不会忘记 reset。

## 4 骨架

```vue
<template>
  <el-dialog v-model="visible" title="书籍详情" append-to-body @opened="onOpened" @closed="onClosed">
    <template v-if="opened">
      <BookDetail v-bind="$attrs" />
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
// 容器：只认识「开关」，不认识业务。业务参数靠 $attrs 原样透传。
defineOptions({ inheritAttrs: false })          // 否则业务参数会被挂到根元素上
const emit = defineEmits(['open', 'close', 'opened', 'closed'])
const { visible, opened, onOpened, onClosed, open, close } = useOverlay(emit)
defineExpose({ open, close })
</script>
```

壳的标签与属性（`el-dialog` / `el-drawer`、宽度、标题）直接写死在容器上。容器是为这一个业务定制的，没必要做成 props；只有同一个壳要被多处复用时，才把壳属性提到外面。

## 5 容器里不写外观样式

`el-dialog` 这类组件被 teleport 到 body，`scoped` 打不到它——在容器里写样式，等于写全局样式。

外观统一放项目的全局样式文件，容器只负责挂类名。内容区的分栏照 `dev-ui-page-layout` 那套骨架用类名，不要在容器里另搭一套。

## 6 自检

1. 业务组件和容器是两个文件吗？命名说的是业务还是位置？
2. 有没有别处直接 import 了业务组件？
3. 开关状态在业务层里吗？
4. 关掉再打开，状态是干净的吗？
5. 容器里有没有出现外观样式？
