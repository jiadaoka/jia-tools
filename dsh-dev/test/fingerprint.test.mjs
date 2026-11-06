import assert from 'node:assert/strict'
import test from 'node:test'

import { fingerprintFrom, repoOf } from '../src/fingerprint.js'

test('认不出任何东西时标记为 unknown（fail-open 的判据）', () => {
  const fingerprint = fingerprintFrom({ files: {}, root: '/nowhere' })
  assert.equal(fingerprint.unknown, true)
  assert.equal(fingerprint.stacks.size, 0)
})

test('package.json 给出 node 与框架', () => {
  const fingerprint = fingerprintFrom({
    files: {
      'package.json': JSON.stringify({ dependencies: { vue: '^3', typescript: '^5' } }),
    },
    root: '/repo',
  })
  assert.equal(fingerprint.unknown, false)
  assert.ok(fingerprint.stacks.has('node'))
  assert.ok(fingerprint.stacks.has('vue'))
  assert.ok(fingerprint.stacks.has('ts'))
})

test('devDependencies 同样参与识别', () => {
  const fingerprint = fingerprintFrom({
    files: { 'package.json': JSON.stringify({ devDependencies: { react: '^18' } }) },
    root: '/repo',
  })
  assert.ok(fingerprint.stacks.has('react'))
})

test('标记文件按存在即识别，不需要读内容', () => {
  const fingerprint = fingerprintFrom({ files: { 'go.mod': 'module x' }, root: '/repo' })
  assert.ok(fingerprint.stacks.has('go'))
})

test('坏掉的 package.json 只损失框架信息，不抛错', () => {
  const fingerprint = fingerprintFrom({ files: { 'package.json': '{oops' }, root: '/repo' })
  assert.ok(fingerprint.stacks.has('node'))
  assert.equal(fingerprint.unknown, false)
})

test('仓库名从 git config 的 url 里取最后一段', () => {
  assert.equal(repoOf('[remote "origin"]\n\turl = git@github.com:jiadaoka/jia-tools.git'), 'jia-tools')
  assert.equal(repoOf('[remote "origin"]\n\turl = https://github.com/a/b'), 'b')
  assert.equal(repoOf('[core]\n\tbare = false'), undefined)
  assert.equal(repoOf(undefined), undefined)
})

test('有仓库没有技术栈时不算 unknown', () => {
  const fingerprint = fingerprintFrom({
    files: { '.git/config': '[remote "origin"]\n\turl = git@host:me/thing.git' },
    root: '/repo',
  })
  assert.equal(fingerprint.unknown, false)
  assert.deepEqual(fingerprint.repos, ['thing'])
})
