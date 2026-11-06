/**
 * 身份装配：决定一条条款在当前上下文里该不该被看见。
 *
 * 判据不是「某目录 → 某套规范」的映射表，而是**声明范围与当前身份的求交**。
 * 这样新增条款只要守住命名或声明范围，可见性自动正确，不需要改代码——
 * 需要改代码才能加规则的规范包，规则数量会停止增长。
 */

/** 已知技术栈。第二个词落在这张表里的条款，只在对应栈下可见。 */
export const STACKS = new Set([
  'vue',
  'react',
  'svelte',
  'next',
  'nuxt',
  'angular',
  'ts',
  'node',
  'python',
  'go',
  'java',
  'rust',
  'android',
  'php',
  'ruby',
])

/**
 * 一条条款对当前身份是否可见。
 *
 * 三条规则，按顺序：
 *
 *   1. 识别不出身份 → 全部可见（fail-open）。藏起来的代价大于多给的代价：
 *      规范多给几条最多是噪声，被藏起来是静默失效，表现为「模型突然开始乱写」。
 *   2. `dev-<栈>-*` → 栈必须命中。
 *   3. `metadata.repo` → 仓库必须命中。
 *
 * 仓库用声明而不是前缀：仓库名常含连字符（`dev-tools-service`），
 * 前缀解析在第一个 `-` 处就有歧义，声明没有。
 *
 * @param skill 至少含 name 与可选的 repo 声明
 * @param fingerprint 当前身份，见 fingerprint.js
 */
export function visibleTo(skill, fingerprint) {
  if (fingerprint.unknown === true) return true

  if (skill.repo !== undefined) return fingerprint.repos.includes(skill.repo)

  const parts = skill.name.split('-')
  if (parts[0] !== 'dev') return true
  const candidate = parts[1]
  if (candidate === undefined || !STACKS.has(candidate)) return true
  return fingerprint.stacks.has(candidate)
}

/** 从全部条款里挑出当前可见的那些，保持输入顺序。 */
export function assemble(skills, fingerprint) {
  return skills.filter((skill) => visibleTo(skill, fingerprint))
}
