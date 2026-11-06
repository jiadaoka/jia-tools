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
import { fileURLToPath } from 'node:url'

import { assemble } from './src/assembly.js'
import { createCatalog, PROVIDER_NAME, toCandidate, toDefinition } from './src/catalog.js'
import { createFingerprintCache } from './src/fingerprint.js'
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
    return watcher
  } catch {
    return undefined
  }
}

export function apply(ctx) {
  const catalog = createCatalog(SKILLS_ROOT)
  const fingerprints = createFingerprintCache()

  // 第一层：按身份装配的条款。
  //
  // 用 provider 而不是 register()：register 注册的是全局清单，provider 的
  // list(options) 拿得到 cwd，才能按「这是哪个项目」决定露出哪几条。
  ctx.skills.registerProvider((control) => {
    const watcher = watchSkills(SKILLS_ROOT, () => {
      catalog.reload()
      fingerprints.clear()
      control.invalidate()
    })
    control.signal.addEventListener('abort', () => watcher?.close(), { once: true })

    return {
      name: PROVIDER_NAME,

      async list(options = {}) {
        const cwd = options.cwd ?? process.cwd()
        return assemble(catalog.all(), fingerprints.of(cwd)).map(toCandidate)
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
}
