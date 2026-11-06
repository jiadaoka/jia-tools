import assert from 'node:assert/strict'
import test from 'node:test'

import { assemble, STACKS, visibleTo } from '../src/assembly.js'

const fp = (stacks = [], repos = []) => ({ stacks: new Set(stacks), repos, unknown: false })
const unknown = { stacks: new Set(), repos: [], unknown: true }

test('认不出身份时全部可见', () => {
  assert.equal(visibleTo({ name: 'dev-vue-sfc-order' }, unknown), true)
  assert.equal(visibleTo({ name: 'dev-git-commit' }, unknown), true)
})

test('通用条款在任何身份下都可见', () => {
  for (const name of ['dev-git-commit', 'dev-source-first', 'dev-file-safety']) {
    assert.equal(visibleTo({ name }, fp(['python'])), true, name)
    assert.equal(visibleTo({ name }, fp([])), true, name)
  }
})

test('栈条款只在该栈下可见', () => {
  assert.equal(visibleTo({ name: 'dev-vue-sfc-order' }, fp(['vue'])), true)
  assert.equal(visibleTo({ name: 'dev-vue-sfc-order' }, fp(['react'])), false)
  assert.equal(visibleTo({ name: 'dev-vue-sfc-order' }, fp(['vue', 'ts'])), true)
})

test('第二个词不在栈表里就当作通用条款', () => {
  assert.equal(STACKS.has('git'), false)
  assert.equal(visibleTo({ name: 'dev-git-commit' }, fp(['go'])), true)
})

test('仓库声明按名字匹配，不按前缀解析', () => {
  const skill = { name: 'dev-local-facts', repo: 'jia-tools' }
  assert.equal(visibleTo(skill, fp(['node'], ['jia-tools'])), true)
  assert.equal(visibleTo(skill, fp(['node'], ['other'])), false)
})

test('仓库声明优先于名字前缀', () => {
  // 名字看起来像栈条款，但声明了仓库：按仓库判，不按栈判。
  const skill = { name: 'dev-vue-facts', repo: 'alpha' }
  assert.equal(visibleTo(skill, fp(['vue'], ['beta'])), false)
  assert.equal(visibleTo(skill, fp([], ['alpha'])), true)
})

test('装配保持输入顺序并过滤', () => {
  const skills = [
    { name: 'dev-git-commit' },
    { name: 'dev-vue-sfc-order' },
    { name: 'dev-file-safety' },
  ]
  assert.deepEqual(
    assemble(skills, fp(['vue'])).map((skill) => skill.name),
    ['dev-git-commit', 'dev-vue-sfc-order', 'dev-file-safety'],
  )
  assert.deepEqual(
    assemble(skills, fp(['python'])).map((skill) => skill.name),
    ['dev-git-commit', 'dev-file-safety'],
  )
})
