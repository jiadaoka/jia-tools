/**
 * dsh-predev — 开发之前。
 *
 * A DeepSeek Harness (DSH) bundle plugin registering three runtime skills
 * that carry an idea from "我准备搞个小玩意" to the first line of code:
 *
 *   - `predev`         (model + user)  the conversation and the record: tier
 *                                      the investment, ask only the frontier,
 *                                      stop on the floor, write PREDEV.md.
 *   - `predev-sketch`  (model + user)  a throwaway, deliberately fake
 *                                      prototype that answers one question.
 *   - `predev-wait`    (user only)     "that did not land, re-pitch it".
 *
 * Two skills, not five: asking and recording are one act, and a prototype is
 * the only thing here that produces something other than a decision.
 *
 * Skill bodies are plain `skills/<name>/SKILL.md` files carrying the same
 * frontmatter grammar the DSH filesystem provider understands, so the very
 * same files work either through this bundle or as ordinary entries under
 * `<project>/.dsh/skills/`.
 *
 * The Cordis Loader reads this module's namespace object directly, so the
 * three capabilities below are named exports. A default export is never
 * consulted, and this file deliberately has none.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-predev'
export const inject = ['skills']

/** Skill directory names, in catalog order. Each must equal its frontmatter `name`. */
const SKILL_IDS = ['predev', 'predev-sketch', 'predev-wait']

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/

/** The strict boolean grammar DSH skill frontmatter uses. */
const TRUTHY = new Set(['true', 'yes', 'on', '1'])
const FALSY = new Set(['false', 'no', 'off', '0'])

function toBoolean(raw, key, label) {
  const value = raw.trim().toLowerCase()
  if (TRUTHY.has(value)) return true
  if (FALSY.has(value)) return false
  throw new Error(`dsh-predev: ${label} 的 "${key}" 必须是布尔值，收到 "${raw.trim()}"`)
}

/** Read flat `key: value` frontmatter. Enough for the keys these skills use. */
function readFrontmatter(block, label) {
  const meta = {}
  for (const line of block.split(/\r?\n/)) {
    const entry = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/.exec(line.trim())
    if (entry) meta[entry[1]] = entry[2].trim().replace(/^["']|["']$/g, '')
  }
  if (!meta.name) throw new Error(`dsh-predev: ${label} 的 frontmatter 缺少 name`)
  if (!meta.description) throw new Error(`dsh-predev: ${label} 的 frontmatter 缺少 description`)
  return meta
}

function loadSkill(skillId) {
  const label = `skills/${skillId}/SKILL.md`
  const file = new URL(`./${label}`, import.meta.url)

  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`dsh-predev: 读不到 ${label}（${fileURLToPath(file)}）：${error.message}`)
  }

  const match = FRONTMATTER.exec(text.replace(/^\uFEFF/, ''))
  if (!match) throw new Error(`dsh-predev: ${label} 必须以 YAML frontmatter 开头`)

  const meta = readFrontmatter(match[1], label)
  if (meta.name !== skillId) {
    throw new Error(
      `dsh-predev: ${label} 的 frontmatter name 是 "${meta.name}"，目录名是 "${skillId}"，两者必须一致`,
    )
  }

  const content = match[2].trim()
  if (!content) throw new Error(`dsh-predev: ${label} 的正文是空的`)

  const skill = {
    name: meta.name,
    description: meta.description,
    content,
    source: 'runtime',
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
  }
  if (meta.whenToUse) skill.whenToUse = meta.whenToUse
  return skill
}

export function apply(ctx) {
  // Registering inside apply() is itself the Cordis effect: unmounting the
  // bundle unregisters every skill. A malformed skill throws here, so the
  // failure is a refused mount naming the file rather than a skill that is
  // silently absent from the catalog.
  for (const skillId of SKILL_IDS) {
    ctx.skills.register(loadSkill(skillId))
  }
}
