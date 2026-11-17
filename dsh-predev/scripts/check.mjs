#!/usr/bin/env node
/**
 * dsh-predev self-check.
 *
 * Runs the plugin's `apply()` against a stub `ctx.skills`, so a typo in any
 * SKILL.md frontmatter fails here in a second instead of surfacing as a
 * refused mount on the next profile start.
 *
 *   node scripts/check.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { apply, inject, name } from '../index.js'

const EXPECTED = {
  predev: { modelInvocable: true, userInvocable: true },
  'predev-req': { modelInvocable: true, userInvocable: true },
  'predev-sketch': { modelInvocable: true, userInvocable: true },
  'predev-req-ui': { modelInvocable: true, userInvocable: true },
  'predev-wait': { modelInvocable: false, userInvocable: true },
}

// 这个包要能单独装到任何项目上，技能正文里一旦漏进某个具体产品/某家设计系统的
// 名字，条款就只在那个项目里成立。这类污染读的时候不刺眼，用的时候才发现整段
// 用不上——所以卡在装之前，而不是等下次在别的项目里踩到。
const FORBIDDEN = [
  { pattern: /\bSNC\b|新炬|snc-/i, why: '具体产品名' },
  { pattern: /ops-copilot|CMDB|Browser-harness|auto-test/i, why: '具体项目/工具链' },
  { pattern: /dsh-req|requirement-handoff|requirement-analysis-v\d/i, why: '外部技能或仓库名' },
  { pattern: /智能体|告警|运维|探针/, why: '某个业务域的专有名词' },
]

const problems = []
const registered = new Map()

apply({
  skills: {
    register(skill) {
      if (registered.has(skill.name)) problems.push(`重复注册：${skill.name}`)
      registered.set(skill.name, skill)
      return () => {}
    },
  },
})

if (inject.join() !== 'skills') problems.push(`inject 应为 ['skills']，实际是 ${JSON.stringify(inject)}`)

for (const [skillName, policy] of Object.entries(EXPECTED)) {
  const skill = registered.get(skillName)
  if (!skill) {
    problems.push(`缺技能：${skillName}`)
    continue
  }
  if (skill.source !== 'runtime') problems.push(`${skillName}: source 应为 runtime`)
  if (!skill.description.trim()) problems.push(`${skillName}: description 是空的`)
  if (!skill.content.trim()) problems.push(`${skillName}: 正文是空的`)
  if (skill.invocation.modelInvocable !== policy.modelInvocable) {
    problems.push(`${skillName}: modelInvocable 应为 ${policy.modelInvocable}`)
  }
  if (skill.invocation.userInvocable !== policy.userInvocable) {
    problems.push(`${skillName}: userInvocable 应为 ${policy.userInvocable}`)
  }
}

for (const extra of registered.keys()) {
  if (!(extra in EXPECTED)) problems.push(`多出来的技能：${extra}`)
}

// A skill may only point at another skill that exists, otherwise the
// "load predev-sketch" hand-off dead-ends at runtime. Names may be one segment
// (`predev`) or more (`predev-req-ui`), so the pattern has to accept a chain.
for (const [skillName, skill] of registered) {
  for (const [, reference] of skill.content.matchAll(/`(predev(?:-[a-z]+)*)`/g)) {
    if (!(reference in EXPECTED)) problems.push(`${skillName}: 引用了不存在的技能 ${reference}`)
  }
  for (const { pattern, why } of FORBIDDEN) {
    const hit = `${skill.description}\n${skill.content}`.match(pattern)
    if (hit !== null) problems.push(`${skillName}: 正文里有${why}（${hit[0]}），条款换项目就不成立了`)
  }
}

// The same files must stay loadable as plain .dsh/skills/ entries, which means
// the frontmatter has to be valid YAML, not merely YAML-shaped.
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
for (const skillName of Object.keys(EXPECTED)) {
  const file = fileURLToPath(new URL(`../skills/${skillName}/SKILL.md`, import.meta.url))
  const match = FRONTMATTER.exec(readFileSync(file, 'utf8'))
  if (!match) {
    problems.push(`skills/${skillName}/SKILL.md: 没有 frontmatter`)
    continue
  }
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    if (!/^[A-Za-z][A-Za-z0-9-]*\s*:/.test(line.trim())) {
      problems.push(`skills/${skillName}/SKILL.md: 这行不是合法的 frontmatter 键值对：${line}`)
    }
    if (/^[A-Za-z][A-Za-z0-9-]*\s*:.*:\s/.test(line) && !/"|'/.test(line)) {
      problems.push(`skills/${skillName}/SKILL.md: 值里有 “: ”，必须加引号：${line}`)
    }
    if (line.includes('"') && (line.match(/"/g) ?? []).length % 2 !== 0) {
      problems.push(`skills/${skillName}/SKILL.md: 双引号不成对：${line}`)
    }
  }
}

if (problems.length) {
  console.error(`${name}: ${problems.length} 个问题\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`${name}: ${registered.size} 个技能全部通过`)
for (const [skillName, skill] of registered) {
  const { modelInvocable, userInvocable } = skill.invocation
  console.log(`  ${skillName.padEnd(14)} model=${modelInvocable ? 'y' : 'n'} user=${userInvocable ? 'y' : 'n'}`)
}
