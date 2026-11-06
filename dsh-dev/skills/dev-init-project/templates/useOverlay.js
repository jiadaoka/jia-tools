// 容器（弹窗、抽屉）的开关状态。放在项目的共享逻辑目录，多个容器共用这一份。
//
//   const emit = defineEmits(['open', 'close', 'opened', 'closed'])
//   const { visible, opened, open, close, onOpened, onClosed } = useOverlay(emit)
//
// visible 绑容器的 v-model；opened 用来在打开之后才挂载业务层；
// onOpened / onClosed 接组件的 @opened / @closed；open / close 交给父组件 defineExpose。
//
// 事件按时机抛给父组件：open / close 是开始动作，opened / closed 是动画结束。
// 容器声明了这四个 emits 之后，父组件的 @open 这类监听器不会再落进容器的 $attrs——
// 壳的事件留在壳上，不会跟着业务参数一起透传给业务层。
import { ref } from 'vue'

export function useOverlay(emit) {
  const visible = ref(false)
  const opened = ref(false)

  const open = () => {
    if (visible.value) return
    visible.value = true
    emit?.('open')
  }

  const close = () => {
    if (!visible.value) return
    visible.value = false
    emit?.('close')
  }

  const onOpened = () => {
    opened.value = true
    emit?.('opened')
  }

  const onClosed = () => {
    opened.value = false
    emit?.('closed')
  }

  return { visible, opened, open, close, onOpened, onClosed }
}
