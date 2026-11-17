import assert from 'node:assert/strict'
import test from 'node:test'

import {
  describeScope,
  diffCommands,
  formatFilesTxt,
  lintVerdicts,
  parseCoverage,
  parseFilesTxt,
  reconcile,
} from '../src/report.js'

const FILES_TXT = 'src/a.js\nsrc/b.js\nsrc/c.js'

const REPORT = `# 目录树统一处理 — jia-tools 审查报告 R1

> 裁定：⚠️ 修完再看

## 1 元数据

| 字段 | 值 |
|---|---|
| 对象 | jia-tools |

## 2 覆盖清单

| # | 文件 | 变更 | 结论 |
|---|---|---|---|
| 1 | \`src/a.js\` | M +12/-3 | ✅ |
| 2 | \`src/b.js\` | A +40 | ⚠️ H-1 M-2 |
| 3 | \`package-lock.json\` | M +900 | — 未审：锁文件 |

覆盖 3/3 个可审文件。

## 3 问题清单

### 3.2 🟠 high（1）

#### H-1 空集合返回 null
`

test('files.txt 一行一个文件，不带变更量', () => {
  const payload = {
    reviewable_files: [
      { path: 'a.js', status: 'modified', insertions: 1, deletions: 1 },
      { path: 'b.ts', status: 'added', insertions: 9, deletions: 0 },
    ],
  }
  assert.equal(formatFilesTxt(payload), 'a.js\nb.ts')
  assert.equal(formatFilesTxt({ reviewable_files: [] }), '')
})

test('多仓时带上仓库名，用制表符分隔', () => {
  const payload = { reviewable_files: [{ path: 'a.js' }] }
  assert.equal(formatFilesTxt(payload, 'repo-x'), 'repo-x\ta.js')
})

test('读回 files.txt 时兼容两种写法', () => {
  assert.deepEqual(parseFilesTxt('src/a.js\nsrc/b.js'), ['src/a.js', 'src/b.js'])
  assert.deepEqual(parseFilesTxt('repo\t\tsrc/a.js\nsrc/b.js'), ['src/a.js', 'src/b.js'])
  assert.deepEqual(parseFilesTxt('# 注释\n\nsrc/a.js\n'), ['src/a.js'])
})

test('从报告里取覆盖表', () => {
  const { rows, problems } = parseCoverage(REPORT)
  assert.deepEqual(problems, [])
  assert.deepEqual(
    rows.map((row) => row.path),
    ['src/a.js', 'src/b.js', 'package-lock.json'],
  )
  assert.equal(rows[1].verdict, '⚠️ H-1 M-2')
})

test('缺章节、缺表格、通配行都要报出来，且不混成覆盖问题', () => {
  assert.deepEqual(parseCoverage('').problems, ['报告是空的'])
  assert.match(parseCoverage('# 报告\n\n没有覆盖节').problems[0], /找不到/)

  const wildcard = `## 2 覆盖清单

| # | 文件 | 变更 | 结论 |
|---|---|---|---|
| 1 | \`i18n/messages*.properties ×4\` | M | ✅ |
`
  const result = parseCoverage(wildcard)
  assert.equal(result.rows.length, 0)
  assert.match(result.problems[0], /一行必须对应一个文件/)
})

test('对账：漏审、越界、重复分得清', () => {
  const rows = parseCoverage(REPORT).rows

  const extraOnly = reconcile(['src/a.js', 'src/b.js'], rows)
  assert.deepEqual(extraOnly.missing, [])
  assert.deepEqual(extraOnly.extra, ['package-lock.json'])
  assert.equal(extraOnly.ok, false)

  const missing = reconcile(['src/a.js', 'src/b.js', 'src/c.js'], rows)
  assert.deepEqual(missing.missing, ['src/c.js'])
  assert.equal(missing.covered, 2)
  assert.equal(missing.total, 3)

  const duplicated = reconcile(['src/a.js'], [{ path: 'src/a.js' }, { path: 'src/a.js' }])
  assert.deepEqual(duplicated.duplicated, ['src/a.js'])
})

test('全覆盖时 ok 为 true', () => {
  const rows = [{ path: 'a.js', verdict: '✅' }, { path: 'b.js', verdict: '✅' }]
  const result = reconcile(['a.js', 'b.js'], rows)
  assert.equal(result.ok, true)
  assert.equal(result.covered, 2)
})

test('结论列只允许三种写法', () => {
  assert.deepEqual(lintVerdicts([{ path: 'a.js', verdict: '✅' }]), [])
  assert.deepEqual(lintVerdicts([{ path: 'b.js', verdict: '⚠️ H-1 顺手再提' }]), [])
  assert.deepEqual(lintVerdicts([{ path: 'c.js', verdict: '— 未审：生成物' }]), [])
  assert.equal(lintVerdicts([{ path: 'd.js', verdict: '通过' }]).length, 1)
  assert.equal(lintVerdicts([{ path: 'e.js', verdict: '' }]).length, 1)
})

test('取 diff 的命令按 mode 给，不让模型自己拼 ref', () => {
  assert.equal(diffCommands({ mode: 'workspace' }), 'git diff HEAD -- <path>')
  assert.equal(
    diffCommands({ mode: 'range', merge_base: '2e50b202', to: 'feat' }),
    'git diff 2e50b202..feat -- <path>',
  )
  assert.equal(diffCommands({ mode: 'commit', commit: 'abc123' }), 'git show abc123 -- <path>')
})

test('摘要一行说清范围与规模', () => {
  assert.equal(
    describeScope({
      mode: 'workspace',
      total_files: 19,
      reviewable_count: 10,
      excluded_count: 9,
      total_insertions: 544,
      total_deletions: 69,
    }),
    'workspace（未提交改动）：可审 10/19 个文件，+544/-69，排除 9 个',
  )
})
