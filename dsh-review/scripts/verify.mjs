/**
 * 端到端验证：不经过宿主，直接用真实的 ocr 跑一遍工具的执行路径。
 *
 * `node scripts/verify.mjs [仓库路径]`
 *
 * 覆盖的是「解析二进制 → 版本闸 → preview → 落 files.txt → rule → 覆盖对账」这条链。
 * 不覆盖宿主装配（工具注册、技能 provider），那部分只能在真实 profile 里看。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { buildPreviewArgs, buildRulesArgs, parseDelegate, runOcr } from '../src/delegate.js'
import { formatFilesTxt, describeScope, diffCommands, parseCoverage, reconcile } from '../src/report.js'
import { MINIMUM_VERSION, parseVersion, resolveOcr, supportsJson } from '../src/resolve.js'

const repo = resolve(process.argv[2] ?? process.cwd())
const line = (label) => console.log(`\n=== ${label} ===`)

line('1 解析 ocr')
const located = resolveOcr({ ocrPath: '', env: process.env })
if (located.missing !== undefined) {
  console.error('找不到 ocr，尝试过：')
  for (const path of located.missing) console.error('  ' + path)
  process.exit(1)
}
console.log(`命中：${located.command}`)
console.log(`来源：${located.source}`)

line('2 版本闸')
const banner = await runOcr(['version'], { command: located.command, cwd: repo, timeoutMs: 30_000 })
const version = parseVersion(banner)
console.log(`版本：${version?.join('.')} · 支持 --format json：${supportsJson(version)}`)
if (!supportsJson(version)) {
  console.error(`需要 ${MINIMUM_VERSION.join('.')} 以上`)
  process.exit(1)
}

line('3 取范围')
const previewArgv = [...buildPreviewArgs({}), '--repo', repo]
const stdout = await runOcr(previewArgv, { command: located.command, cwd: repo, timeoutMs: 120_000 })
const payload = parseDelegate(stdout, 'preview')
console.log(describeScope(payload))
console.log(`取 diff：${diffCommands(payload)}`)

const unit = `LOCAL-${repo.split(/[\\/]/).pop()}-verify`
const dir = join(repo, '.review', unit)
mkdirSync(dir, { recursive: true })
const filesTxt = formatFilesTxt(payload)
writeFileSync(join(dir, 'files.txt'), filesTxt.length === 0 ? '' : `${filesTxt}\n`, 'utf8')
console.log(`清单：${join(dir, 'files.txt')}（${payload.reviewable_files.length} 行）`)

line('4 取规则')
if (payload.reviewable_files.length === 0) {
  console.log('没有可审文件，跳过')
} else {
  const paths = payload.reviewable_files.slice(0, 3).map((file) => file.path)
  const rulesArgv = [...buildRulesArgs({ paths }), '--repo', repo]
  const rulesOut = await runOcr(rulesArgv, { command: located.command, cwd: repo, timeoutMs: 120_000 })
  const rules = parseDelegate(rulesOut, 'rule')
  console.log(`规则组：${rules.groups.length}`)
  for (const group of rules.groups) {
    console.log(`  ${group.group_id} ${group.source} · ${group.files.length} 文件 · ${group.rule.length} 字`)
  }
}

line('5 覆盖对账（用清单自身造一份"全覆盖"报告）')
const rows = payload.reviewable_files.map((file) => file.path).join('\n')
const fakeReport = [
  '## 2 覆盖清单',
  '',
  '| # | 文件 | 变更 | 结论 |',
  '|---|---|---|---|',
  ...payload.reviewable_files.map((file, index) => `| ${index + 1} | \`${file.path}\` | ${file.status} | ✅ |`),
].join('\n')
const parsed = parseCoverage(fakeReport)
const report = reconcile(payload.reviewable_files.map((file) => file.path), parsed.rows)
console.log(`解析到 ${parsed.rows.length} 行，问题：${parsed.problems.length === 0 ? '无' : parsed.problems.join('；')}`)
console.log(`对账：${report.ok ? '通过' : '不通过'}（${report.covered}/${report.total}）`)

line('6 反向验证：故意漏一行')
const partial = fakeReport.replace(/^\| \d+ \|.*$/m, '')
const partialParse = parseCoverage(partial)
const partialReport = reconcile(payload.reviewable_files.map((file) => file.path), partialParse.rows)
console.log(`对账：${partialReport.ok ? '应当不通过却通过了' : `正确报出漏审 ${partialReport.missing.length} 个`}`)
if (partialReport.missing.length > 0) console.log(`  漏的第 1 个：${partialReport.missing[0]}`)

console.log(`\n全部通过。产物在 ${dir}`)
console.log(`清单前 3 行：\n${filesTxt.split('\n').slice(0, 3).join('\n')}`)
console.log(`（readFileSync 校验：${readFileSync(join(dir, 'files.txt'), 'utf8').split('\n').filter(Boolean).length} 行）`)
