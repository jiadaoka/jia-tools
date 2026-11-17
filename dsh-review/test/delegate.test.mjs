import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPreviewArgs, buildRulesArgs, DelegateParseError, parseDelegate } from '../src/delegate.js'

test('默认审工作区改动', () => {
  assert.deepEqual(buildPreviewArgs({}), ['delegate', 'preview', '--format', 'json'])
})

test('三种取范围的方式各自成形', () => {
  assert.deepEqual(buildPreviewArgs({ commit: 'abc123' }), ['delegate', 'preview', '--format', 'json', '--commit', 'abc123'])
  assert.deepEqual(buildPreviewArgs({ from: 'main', to: 'feat' }), [
    'delegate',
    'preview',
    '--format',
    'json',
    '--from',
    'main',
    '--to',
    'feat',
  ])
})

test('互斥参数就地拒绝，不等 ocr 报错', () => {
  assert.throws(() => buildPreviewArgs({ commit: 'abc', from: 'main', to: 'feat' }), /commit 不能与 from\/to/)
  assert.throws(() => buildPreviewArgs({ from: 'main' }), /成对/)
  assert.throws(() => buildPreviewArgs({ to: 'feat' }), /成对/)
  assert.throws(() => buildPreviewArgs({ background: 'x', backgroundFile: 'y.md' }), /只能给一个/)
})

test('可选参数按需追加', () => {
  const args = buildPreviewArgs({ exclude: 'docs/**,*.lock', backgroundFile: 'req.md' })
  assert.ok(args.includes('--exclude') && args.includes('docs/**,*.lock'))
  assert.ok(args.includes('--background-file') && args.includes('req.md'))
  assert.ok(!args.includes('--background'), 'backgroundFile 与 background 不同用')
})

test('rule 参数至少要一个路径', () => {
  assert.deepEqual(buildRulesArgs({ paths: ['a.js', 'b.js'] }), ['delegate', 'rule', '--format', 'json', 'a.js', 'b.js'])
  assert.throws(() => buildRulesArgs({ paths: [] }), /不能为空/)
  assert.throws(() => buildRulesArgs({}), /不能为空/)
})

const PREVIEW = JSON.stringify({
  schema_version: '1',
  mode: 'workspace',
  reviewable_files: [{ path: 'a.js', status: 'modified', insertions: 1, deletions: 0 }],
  excluded_files: [{ path: 'b.md', exclude_reason: 'unsupported_ext' }],
})

test('正常 JSON 直接解析', () => {
  const payload = parseDelegate(PREVIEW, 'preview')
  assert.equal(payload.mode, 'workspace')
  assert.equal(payload.reviewable_files.length, 1)
})

test('前面有日志、末尾有空行也能取出 JSON', () => {
  const noisy = `resolving repo...\n${PREVIEW}\n\n`
  const payload = parseDelegate(noisy, 'preview')
  assert.equal(payload.reviewable_files[0].path, 'a.js')
})

test('空输出与非法 JSON 分开报', () => {
  assert.throws(() => parseDelegate('', 'preview'), DelegateParseError)
  assert.throws(() => parseDelegate('   \n', 'preview'), /没有输出/)
  assert.throws(() => parseDelegate('Error: not a git repository', 'preview'), /没有 JSON/)
  assert.throws(() => parseDelegate('{oops}', 'preview'), /不是合法 JSON/)
})

test('字段缺失时说清缺哪个', () => {
  assert.throws(() => parseDelegate('{"mode":"workspace","reviewable_files":[]}', 'preview'), /excluded_files/)
  assert.throws(() => parseDelegate('{"schema_version":"1"}', 'rule'), /groups/)
})

test('BOM 不影响解析', () => {
  const payload = parseDelegate(`\uFEFF${PREVIEW}`, 'preview')
  assert.equal(payload.mode, 'workspace')
})
