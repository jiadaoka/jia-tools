/**
 * 目录扫描：把 `skills/` 下的 Markdown 读成技能定义。
 *
 * 与 `dsh-dev` 的那份同形，但故意不共享代码（两个包互不 import）：
 * 这边少一个「按仓库过滤」的维度，多一条「技能正文不许与工具抢第一步」的断言。
 *
 * 清单不在这里维护。加一条就是加一个目录，删一条就是删一个目录。
 * frontmatter 写坏时挂载直接抛错并指名文件——静默少一条技能是这类规则包最典型的失效。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** provider 名。`runtime` 是保留字，不能占用。 */
export const PROVIDER_NAME = 'review'

/** 排序权重：低于项目级 `.dsh/skills`，高于用户级。 */
export const SKILL_RANK = 260

/** DSH 只把 description 的前 500 字符渲染进 catalog，超长会被静默截断。 */
export const DESCRIPTION_MAX = 500

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/
const TRUTHY = new Set(['true', 'yes', 'on', '1'])
const FALSY = new Set(['false', 'no', 'off', '0'])

function readFrontmatter(block, label) {
  const meta = {}
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) continue
    const nested = /^\s+([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/.exec(line)
    if (nested !== null) {
      meta[`meta.${nested[1]}`] = nested[2].trim().replace(/^["']|["']$/g, '')
      continue
    }
    if (/^\s/.test(line)) continue
    const flat = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/.exec(line.trim())
    if (flat !== null) meta[flat[1]] = flat[2].trim().replace(/^["']|["']$/g, '')
  }
  if (!meta.name) throw new Error(`dsh-review: ${label} 的 frontmatter 缺少 name`)
  if (!meta.description) throw new Error(`dsh-review: ${label} 的 frontmatter 缺少 description`)
  return meta
}

function toBoolean(raw, key, label) {
  const value = raw.trim().toLowerCase()
  if (TRUTHY.has(value)) return true
  if (FALSY.has(value)) return false
  throw new Error(`dsh-review: ${label} 的 "${key}" 必须是布尔值，收到 "${raw.trim()}"`)
}

/**
 * 解析一份技能。
 *
 * @param text SKILL.md 全文
 * @param directoryName 目录名，必须等于 frontmatter 的 name
 */
export function parseSkill(text, directoryName) {
  const label = `skills/${directoryName}/SKILL.md`
  const match = FRONTMATTER.exec(text.replace(/^\uFEFF/, ''))
  if (match === null) throw new Error(`dsh-review: ${label} 必须以 YAML frontmatter 开头`)

  const meta = readFrontmatter(match[1], label)
  if (meta.name !== directoryName) {
    throw new Error(
      `dsh-review: ${label} 的 frontmatter name 是 "${meta.name}"，目录名是 "${directoryName}"，两者必须一致`,
    )
  }
  if (meta.description.length > DESCRIPTION_MAX) {
    throw new Error(
      `dsh-review: ${label} 的 description 有 ${meta.description.length} 个字符，超过 ${DESCRIPTION_MAX} 会被截断`,
    )
  }

  const content = match[2].trim()
  if (content.length === 0) throw new Error(`dsh-review: ${label} 的正文是空的`)

  return {
    name: meta.name,
    description: meta.description,
    content,
    directory: directoryName,
    scope: meta['meta.scope'],
    invocation: {
      modelInvocable:
        meta['disable-model-invocation'] === undefined
          ? true
          : !toBoolean(meta['disable-model-invocation'], 'disable-model-invocation', label),
      userInvocable:
        meta['user-invocable'] === undefined
          ? true
          : toBoolean(meta['user-invocable'], 'user-invocable', label),
    },
    ...(meta.whenToUse !== undefined ? { whenToUse: meta.whenToUse } : {}),
  }
}

/** 目录里的技能名，字典序，保证每次挂载顺序一致。 */
export function listSkillDirectories(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
}

/**
 * 目录缓存。`reload()` 在文件变化后由外部触发，配合 provider 的
 * `control.invalidate()` 让改技能不必重启。
 */
export function createCatalog(root) {
  let skills

  function load() {
    skills = listSkillDirectories(root).map((directory) => {
      const file = join(root, directory, 'SKILL.md')
      let text
      try {
        text = readFileSync(file, 'utf8')
      } catch (error) {
        throw new Error(`dsh-review: 读不到 ${file}：${error.message}`)
      }
      return { ...parseSkill(text, directory), file, directoryPath: join(root, directory) }
    })
    return skills
  }

  return {
    root,
    all() {
      return skills ?? load()
    },
    reload() {
      skills = undefined
      return this.all()
    },
  }
}

/** candidate：provider.list() 交给注册表的摘要，带一个只有本 provider 认得的不透明 locator。 */
export function toCandidate(skill) {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
    invocation: skill.invocation,
    provider: PROVIDER_NAME,
    source: 'review',
    rank: SKILL_RANK,
    locator: { name: skill.name },
    resourceBase: { kind: 'directory', path: skill.directoryPath },
    path: skill.file,
  }
}

/** definition：provider.get() 返回的完整技能。 */
export function toDefinition(skill) {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
    invocation: skill.invocation,
    source: 'review',
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory', path: skill.directoryPath },
    path: skill.file,
    content: skill.content,
  }
}
