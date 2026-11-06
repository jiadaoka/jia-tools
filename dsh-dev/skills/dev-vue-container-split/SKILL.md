---
name: dev-vue-container-split
description: "容器与业务必须分离：内容永远是独立组件，壳是另一个独立组件，将来换壳不动业务。Vue 3 项目里用弹窗、抽屉、页面内联面板装内容时适用，要写带开关状态的容器或往现有容器里塞内容时适用；内容本身就是壳、或纯静态无状态的分栏不适用。"
metadata:
  layer: ui
  stack: vue
---

# 容器与业务分离

**框是框，业务是业务，两个独立组件，同一个目录：**

```text
BookDetail/            目录名就是业务组件的名字
├─ BookDetail.vue      业务层：它自己是什么，就叫什么
└─ Dialog.vue          容器：只认识"开关"，不认识业务（或 Drawer.vue，二者选一）
```

**业务组件按它实际是什么命名**——`BookDetail`、`UserForm`、`ImportWizard`。不要叫 `Content`、`Body`、`Inner`、`Wrapper`：这类名字不带任何信息，看一眼不知道里面是什么，而且第二个容器一出现就撞名。

**目录里两个文件，对外只有一个入口：容器。** 业务组件由容器挂载，别的地方不该直接 import 它。

**弹窗和抽屉是二选一，不是同时要。** 同一个组件这次是弹窗还是抽屉，是产品决定，不是代码结构——别在一个目录里放两个壳等着将来用。真要换，就是把 `Dialog.vue` 换成 `Drawer.vue`：壳标签和壳属性改掉，业务组件一字不改。

**为什么必须分开**：容器是会换的（弹窗换抽屉、抽屉换页面内联、内联换全屏），业务不会。混在一起，每次换壳都要动业务代码——而这个改动通常发生在你只想改一下弹出方式的时候。

**接口只有三件事：**

1. **参数靠透传**。容器把 `$attrs` 原样交给业务组件，自己不解读。容器模板里一旦出现业务字段名，就已经错了。
2. **开关是容器的职责**。`visible` / `opened` 加 `open()` / `close()`，再加打开与关闭的生命周期钩子。业务层不该知道"自己是被弹出来的"。
3. **业务在打开之后才挂载**。`v-if="opened"`：关闭即销毁，每次打开都是干净状态——不需要手写 reset，也就不会忘记 reset。

## 弹窗上手就要挂的几件事

```vue
<el-dialog
  v-model="visible"
  title="导入 txt"
  :width="640"
  append-to-body
  :close-on-click-modal="false"
  modal-class="dialog-model"
  header-class="dialog-header"
  @opened="onOpened"
  @closed="onClosed"
>
```

- **`modal-class="dialog-model"` 与 `header-class="dialog-header"`**：项目的统一弹窗外观就挂在这两个类名上（去 padding、标题内边距、那根分隔线，定义在 `dev-init-project` 的 `templates/layouts.scss` 里）。**不挂就是 Element Plus 默认长相**，跟项目里别的弹窗对不上——这是最容易漏、漏了最显眼的一步。
- **`append-to-body`**：挂到 body 上，免得被父级 `overflow: hidden` 裁掉，也免得被祖先的 z-index 压住。
- **`:close-on-click-modal="false"`**：里面有用户输了一半的东西，就关掉"点遮罩关闭"。

**容器里不写弹窗外观样式。** `el-dialog` 被 teleport 到 body，`scoped` 打不到它——在容器里写样式等于写全局样式。外观统一放项目的全局样式文件，容器只负责挂类名。

业务层要用骨架装表单和底部按钮时，用的就是 `dev-ui-page-layout` 那套类名——**弹窗内容区不是例外**。

**壳属性直接写死在容器标签上**（`title="导入 txt"`、`:width="640"`）。容器是为这一个业务定制的，没必要做成 props；只有当同一个壳要被多处复用、需要外部把壳属性传进来时才声明 props。

## 开关状态

`useOverlay()` 是项目共享的，接口六个成员：

| 成员 | 作用 |
|---|---|
| `visible` | 绑容器的 `v-model` |
| `opened` | 打开之后才为真，决定业务层挂不挂载 |
| `open()` / `close()` | 交给父组件，通过 `defineExpose` 暴露 |
| `onOpened()` / `onClosed()` | 接组件的 `@opened` / `@closed` |
| 入参 `emit` | 把容器的 `emit` 传进去，开关会按时机向父组件抛 `open` / `close` / `opened` / `closed` |

项目里还没有它时，让 `dev-init-project` 铺（模板 `templates/useOverlay.js`），别在容器旁边就地写一份。

## 实现

```vue
<!-- BookDetail/Dialog.vue（要抽屉就把标签和壳属性换成 Drawer 那份） -->
<template>
  <el-dialog
    v-model="visible"
    title="书籍详情"
    :width="640"
    append-to-body
    :close-on-click-modal="false"
    modal-class="dialog-model"
    header-class="dialog-header"
    @opened="onOpened"
    @closed="onClosed"
  >
    <template v-if="opened">
      <BookDetail v-bind="$attrs" />
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
// 容器：只认识「开关」，不认识业务。业务参数靠 $attrs 原样透传。
import { useOverlay } from '@/composables/useOverlay'

import BookDetail from './BookDetail.vue'

// 必须有：否则业务参数会被 Vue 自动挂到根元素 el-dialog 上
defineOptions({ inheritAttrs: false })

// 声明这四个，父组件的 @open / @opened 就不会混进 $attrs 传给业务层
const emit = defineEmits(['open', 'close', 'opened', 'closed'])
const { visible, opened, onOpened, onClosed, open, close } = useOverlay(emit)

// 父组件：const detail = ref(null)；需要时 detail.value.open()，改状态听 @opened / @closed
defineExpose({ open, close })
</script>
```

```vue
<!-- BookDetail/Drawer.vue —— 与 Dialog.vue 的唯一差别是壳标签和壳属性 -->
<template>
  <el-drawer
    v-model="visible"
    title="书籍详情"
    :size="520"
    append-to-body
    :close-on-click-modal="false"
    @opened="onOpened"
    @closed="onClosed"
  >
    <template v-if="opened">
      <BookDetail v-bind="$attrs" />
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { useOverlay } from '@/composables/useOverlay'

import BookDetail from './BookDetail.vue'

defineOptions({ inheritAttrs: false })

const emit = defineEmits(['open', 'close', 'opened', 'closed'])
const { visible, opened, onOpened, onClosed, open, close } = useOverlay(emit)

defineExpose({ open, close })
</script>
```

```vue
<!-- BookDetail/BookDetail.vue —— 业务层：不知道自己是弹窗还是抽屉，参数从 $attrs 来 -->
<template>
  <div class="book-detail">…</div>
</template>

<script setup lang="ts">
defineProps({
  bookId: { type: [String, Number], required: true },
})
</script>
```

业务自己的事件监听器同样在 `$attrs` 里，会一并透传给业务组件，容器不需要手工转发。

**禁止内联。** 容器必须是独立组件，别处只引用它。把 `<el-dialog>` 直接写在业务页面模板里、中间塞业务表单，等于把框焊死在业务上——这就是这条规范要防的那个动作。

**反面教材**（来自真实项目）：弹出内容一开始直接写在页面里的 `el-dialog` 中间。后来要改成抽屉，动的是业务代码；再后来要求"关闭后清空"，得在每个业务里手写重置，漏一个就是一个脏状态 bug。

**不适用**：内容本身就是壳（例如一个纯展示卡片、一段静态分栏），或者这个组件确定是一次抹掉的实验稿。
