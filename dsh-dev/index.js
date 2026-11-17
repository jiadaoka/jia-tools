/**
 * dsh-dev — 开发时的纪律。
 *
 * 约定写下来不会自己生效。这个插件同时给三个载体，缺一层就有对应的失效：
 *
 *   1. 按需（`skills/`）      有判断空间的条款，按当前身份装配后交给 catalog。
 *   2. 常驻（`prompt.md`）    最易违反、一句话能说清的几条，每轮都在。
 *   3. 门禁（`tools.guard`）  二值判定：版本控制写操作、敏感路径写入。
 *
 * 装配是这里唯一有副作用的地方：判定在 `src/kernel.js`，身份在
 * `src/fingerprint.js`，可见性在 `src/assembly.js`，都是纯函数，可以单测。
 * 规则会频繁改，装配很少改——混在一起的结果是每改一条规则都要跑端到端。
 */

import { watch } from 'node:fs'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assemble } from './src/assembly.js'
import { createCatalog, PROVIDER_NAME, toCandidate, toDefinition } from './src/catalog.js'
import { createFingerprintCache, mergeFingerprints } from './src/fingerprint.js'
import { judge } from './src/kernel.js'

export { PROVIDER_NAME }

export const name = 'dsh-dev'
export const inject = ['skills']

export const SKILLS_ROOT = fileURLToPath(new URL('./skills/', import.meta.url))

/** 常驻提示在提示词里的位置：人格之后（0），计划策略之前（500）。 */
const SECTION_NAME = 'dev:discipline'
const SECTION_ORDER = 100

/** 常驻提示的正文。读不到就让挂载失败，而不是悄悄少一段纪律。 */
export function readResident() {
  const file = new URL('./prompt.md', import.meta.url)
  try {
    return readFileSync(file, 'utf8').trim()
  } catch (error) {
    throw new Error(`dsh-dev: 读不到常驻提示 prompt.md（${fileURLToPath(file)}）：${error.message}`)
  }
}

/**
 * 监听条款目录，改动后让注册表重新收集——改一条条款不必重启进程。
 * 监听失败不是错误：最坏情况是改动要等到下次重启才生效。
 */
function watchSkills(root, onChange) {
  try {
    let timer
    const watcher = watch(root, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(onChange, 200)
    })
    watcher.on('error', () => {})
    // 监听不该成为进程退出的阻碍。一次性命令（`node 某个脚本`）挂完插件就跑完了，
    // 没有这一行，watcher 会把事件循环拽住不放。
    watcher.unref?.()
    return watcher
  } catch {
    return undefined
  }
}

/** 这些目录里的文件触碰不计入「正在哪个项目里干活」。 */
const NOISE_PATH = /(^|[\\/])(?:node_modules|\.git|dist|build|\.dsh|\.idea|\.vscode)([\\/]|$)/

/** 会话内最多记多少个触碰目录。够覆盖「同时开三四个库」，又不会无限读盘。 */
const MAX_TOUCHED = 16

/**
 * 监听文件触碰，把「读到了哪个项目的文件」补进身份。
 *
 * 只有 `cwd` 时，条款是按开会话的那个目录算的：在 A 仓库的会话里读 B 仓库的
 * 组件，B 的栈条款不会出现，模型只能凭记忆写。个人项目里同时开几个库是常态，
 * 所以这里按**栈并集**补：碰过的目录一起参与指纹计算。
 *
 * 与 dsh-snc-dev 的差别：那边要区分「哪个仓库」（便于挂仓库事实），这里只用到
 * 技术栈一层，所以不需要激活表、单调序、去抖刷新那一套。
 *
 * @param ctx 宿主上下文
 * @param fingerprintOf 目录 → 指纹
 * @param touched 已触碰目录（就地修改，调用方读它算并集）
 * @param onNewDir 新目录首次加入时回调（用于刷新技能目录）
 */
function watchTouchedFiles(ctx, fingerprintOf, touched, onNewDir) {
  if (typeof ctx.on !== 'function') return

  const record = (target) => {
    const raw = target?.displayPath ?? target?.path ?? target?.realPath
    if (typeof raw !== 'string' || raw.length === 0) return
    if (NOISE_PATH.test(raw)) return

    const directory = dirname(raw)
    if (touched.includes(directory)) return

    // 认不出栈的目录不必记：它合并进来也只是多读一次盘。
    if (fingerprintOf(directory).unknown) return

    if (touched.length >= MAX_TOUCHED) touched.shift()
    touched.push(directory)
    onNewDir()
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const off = ctx.on('fs/observed', record)
      return typeof off === 'function' ? off : () => {}
    }, 'dsh-dev: 按文件触碰补充身份')
    return
  }
  ctx.on('fs/observed', record)
}

export function apply(ctx) {
  const catalog = createCatalog(SKILLS_ROOT)
  const fingerprints = createFingerprintCache()

  // 会话内触碰过的目录：与 cwd 一起参与身份计算，栈取并集。
  const touched = []
  let control

  const identityOf = (cwd) => {
    const base = fingerprints.of(cwd)
    if (touched.length === 0) return base
    return mergeFingerprints([base, ...touched.map((directory) => fingerprints.of(directory))])
  }

  // 第一层：按身份装配的条款。
  //
  // 用 provider 而不是 register()：register 注册的是全局清单，provider 的
  // list(options) 拿得到 cwd，才能按「这是哪个项目」决定露出哪几条。
  ctx.skills.registerProvider((handle) => {
    control = handle
    const watcher = watchSkills(SKILLS_ROOT, () => {
      // 编辑器保存是「先清空再写入」两步，中间那一瞬 frontmatter 是坏的。
      // 这时解析会抛错，而这里跑在 fs.watch 的定时器里，抛出去就是未捕获异常，
      // 代价是宿主进程直接退出。所以只警告、沿用上一份可用的条款，等下一次改动再试；
      // 挂载期的同类错误仍然照抛——那是「拒绝挂载」，两者不该混为一谈。
      try {
        catalog.reload()
      } catch (error) {
        ctx.logger?.warn?.(`dsh-dev: 条款重载失败，沿用上一份（${error.message}）`)
        return
      }
      fingerprints.clear()
      control.invalidate()
    })
    control.signal.addEventListener('abort', () => watcher?.close(), { once: true })

    return {
      name: PROVIDER_NAME,

      async list(options = {}) {
        const cwd = options.cwd ?? process.cwd()
        return assemble(catalog.all(), identityOf(cwd)).map(toCandidate)
      },

      async get(candidate) {
        const skill = catalog.all().find((entry) => entry.name === candidate.name)
        return skill === undefined ? undefined : toDefinition(skill)
      },
    }
  })

  // 第二层：常驻提示。极小组合里可能没有这个服务，缺了就让那一层静默缺席，
  // 而不是让整个插件挂载失败。
  const prompt = ctx.get('systemPrompt')
  if (prompt !== undefined) {
    prompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: readResident() })
  }

  // 第三层：门禁。
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    tools.guard((execution) => judge(execution, process.env))
  }

  // 身份补充：读到别的项目里的文件时，把那个项目的栈并进来。
  watchTouchedFiles(
    ctx,
    (directory) => fingerprints.of(directory),
    touched,
    () => control?.invalidate?.(),
  )
}
