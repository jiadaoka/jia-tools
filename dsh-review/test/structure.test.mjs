/**
 * 结构断言：把文档里的约定变成会失败的检查。
 *
 * 这类规则包最容易的失效方式是静默失效——技能少了一条、description 改了但不生效、
 * 常驻提示被稀释成 10 条，没有报错，只是不再管用。
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { DESCRIPTION_MAX, listSkillDirectories, parseSkill } from '../src/catalog.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SKILLS = join(ROOT, 'skills')

function read(relative) {
  return readFileSync(join(ROOT, relative), 'utf8').replace(/^\uFEFF/, '')
}

test('每条技能都能被解析，且目录名等于 name', () => {
  for (const directory of listSkillDirectories(SKILLS)) {
    const text = readFileSync(join(SKILLS, directory, 'SKILL.md'), 'utf8')
    assert.doesNotThrow(() => parseSkill(text, directory), directory)
  }
})

test('技能数与目录数一致，且都叫 review-*', () => {
  const directories = listSkillDirectories(SKILLS)
  assert.equal(directories.length, 6, `技能数变了：${directories.join(', ')}`)
  for (const directory of directories) {
    assert.match(directory, /^review-[a-z]+$/, `${directory}: 名字不合约定`)
  }
})

test('description 写清了触发与边界，且不超过截断长度', () => {
  for (const directory of listSkillDirectories(SKILLS)) {
    const text = readFileSync(join(SKILLS, directory, 'SKILL.md'), 'utf8')
    const skill = parseSkill(text, directory)
    assert.ok(skill.description.length <= DESCRIPTION_MAX, `${directory}: ${skill.description.length} 字`)
    assert.match(skill.description, /适用/, `${directory}: 没说什么时候用，路由不到它`)
    assert.match(skill.description, /不适用/, `${directory}: 没写清什么时候不用`)
  }
})

test('正文引用的补充文件真实存在', () => {
  for (const directory of listSkillDirectories(SKILLS)) {
    const text = readFileSync(join(SKILLS, directory, 'SKILL.md'), 'utf8')
    for (const [reference] of text.matchAll(/(?:\.\.\/)?(?:references|examples|templates)\/[\w.-]+/g)) {
      assert.ok(existsSync(join(SKILLS, directory, reference)), `${directory}: ${reference} 不存在`)
    }
  }
})

test('每条技能都有自检清单', () => {
  for (const directory of listSkillDirectories(SKILLS)) {
    const text = readFileSync(join(SKILLS, directory, 'SKILL.md'), 'utf8')
    assert.match(text, /^## 自检$/m, `${directory}: 没有自检清单`)
  }
})

test('技能正文里不出现工作项目专属词', () => {
  // 个人项目没有「合入」「MR 编号」「需求号」这套流程，出现就说明搬运时没脱敏。
  const forbidden = /合入|合并请求|MR\d|REQ-|需求号/
  for (const directory of listSkillDirectories(SKILLS)) {
    const text = readFileSync(join(SKILLS, directory, 'SKILL.md'), 'utf8')
    const hit = forbidden.exec(text)
    assert.equal(hit, null, `${directory}: 出现工作项目词「${hit?.[0]}」`)
  }
})

test('常驻提示是四条，第一条讲只读', () => {
  const items = read('prompt.md')
    .split(/\r?\n/)
    .filter((line) => /^\d+\.\s/.test(line))
  assert.equal(items.length, 4, `常驻有 ${items.length} 条`)
  assert.match(items[0], /只读/, `第一条不是只读约束：${items[0]}`)
  assert.match(items[0], /不改被审代码/)
})

test('常驻第 4 条钉住自审判据不放宽', () => {
  // 审自己的代码是这套纪律最容易破功的地方：作者身份会被当成豁免理由。
  const items = read('prompt.md')
    .split(/\r?\n/)
    .filter((line) => /^\d+\.\s/.test(line))
  assert.match(items[3], /自己/, `第 4 条不是自审约束：${items[3]}`)
  assert.match(items[3], /放宽/, `第 4 条没写「判据不放宽」：${items[3]}`)
})

test('index.js 语法可解析', () => {
  // `node --check` 对 .js 按 CommonJS 解析，而本包是 ESM：复制成 .mjs 再检查。
  const tmp = join(tmpdir(), `dsh-review-index-${process.pid}.mjs`)
  copyFileSync(join(ROOT, 'index.js'), tmp)
  try {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })
    })
  } finally {
    rmSync(tmp, { force: true })
  }
})

test('package.json 声明了 bundle 且不带运行时依赖', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dependencies, undefined, '不引入运行时依赖：ocr 是外部工具，不是 npm 依赖')
  assert.ok(pkg.files.includes('skills'))
  assert.ok(pkg.files.includes('src'))
})

test('cordis.patch.yml 只挂一行，默认值留在代码里', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /id: review-discipline/)
  assert.match(patch, /name: 'dsh-review'/)
  // 配置块被注释掉是刻意的：不配也能用，配的时候才展开。
  assert.ok(!/^\s{6}config:/m.test(patch), 'patch 里不该有生效的 config 块')
})
