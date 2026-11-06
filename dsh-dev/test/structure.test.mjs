/**
 * 结构断言：把文档里的约定变成会失败的检查。
 *
 * 规则包最容易的失效方式不是写错，是静默失效——文件挪走了、范围写错了、
 * 草稿被当成生效条款，没有报错，只是不再生效。
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { SKILLS_ROOT, readResident } from '../index.js'
import { createCatalog, listSkillDirectories, parseSkill } from '../src/catalog.js'

const ROOT = join(SKILLS_ROOT, '..')

test('每条条款都能被解析，且目录名等于 frontmatter 的 name', () => {
  for (const directory of listSkillDirectories(SKILLS_ROOT)) {
    const text = readFileSync(join(SKILLS_ROOT, directory, 'SKILL.md'), 'utf8')
    assert.doesNotThrow(() => parseSkill(text, directory), directory)
  }
})

test('条款数量与目录数量一致（没有静默丢失）', () => {
  const catalog = createCatalog(SKILLS_ROOT)
  assert.equal(catalog.all().length, listSkillDirectories(SKILLS_ROOT).length)
  assert.ok(catalog.all().length > 0, '一条条款都没有')
})

test('每条 description 都写清了什么时候适用', () => {
  for (const skill of createCatalog(SKILLS_ROOT).all()) {
    assert.match(skill.description, /适用|触发/, `${skill.name}: 模型路由不到它`)
    assert.ok(skill.description.length <= 500, `${skill.name}: 超过 500 会被截断`)
  }
})

test('声明了无条件适用的条款可以不写「不适用」，其余应当写', () => {
  const missing = createCatalog(SKILLS_ROOT)
    .all()
    .filter((skill) => skill.scope !== 'always' && !/不适用|不触/.test(skill.description))
  assert.deepEqual(missing.map((skill) => skill.name), [], '这些条款缺「不适用」边界')
})

test('正文引用的补充文件真实存在', () => {
  for (const skill of createCatalog(SKILLS_ROOT).all()) {
    for (const [reference] of skill.content.matchAll(/(?:\.\.\/)?(?:references|examples|templates)\/[\w.-]+/g)) {
      // 只有本技能目录里真有这类子目录，才算「引用自己的补充文件」；
      // 否则那句话是在描述别的技能的模板，不是路径。
      const kind = reference.replace(/^\.\.\//, '').split('/')[0]
      if (!existsSync(join(skill.directoryPath, kind))) continue
      assert.ok(existsSync(join(skill.directoryPath, reference)), `${skill.name}: ${reference} 不存在`)
    }
  }
})

test('草稿区里没有生效形态的文件', () => {
  const draft = join(ROOT, 'draft')
  assert.ok(existsSync(draft), 'draft/ 不存在：撤下的条款没有落点')
  for (const entry of readdirSync(draft, { recursive: true })) {
    const name = String(entry)
    assert.ok(!name.endsWith('SKILL.md'), `draft/${name} 会被当成生效条款`)
  }
})

test('常驻提示控制在 4–6 条', () => {
  const items = readResident().split(/\r?\n/).filter((line) => /^\d+\.\s/.test(line))
  assert.ok(items.length >= 4, `常驻提示只有 ${items.length} 条，太少`)
  assert.ok(items.length <= 6, `常驻提示有 ${items.length} 条，注意力会被稀释`)
})

test('公共条款里不出现具体仓库事实', () => {
  // 只查最容易误认的两种：本机地址与内网地址。其余事实靠人工评审。
  const leak = /(?:localhost|127\.0\.0\.1):\d{2,5}\b|\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/
  for (const skill of createCatalog(SKILLS_ROOT).all()) {
    const hit = leak.exec(skill.content)
    assert.equal(hit, null, `${skill.name}: 出现仓库事实「${hit?.[0]}」`)
  }
})
