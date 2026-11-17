/**
 * 审查报告的机械部分：范围清单的落盘形状、覆盖表的解析、两者对账。
 *
 * 全是纯函数。放这里的原因是覆盖对账是这类报告最容易造假的一格：
 * 写「覆盖 12/12」而实际只审了 10 个，肉眼看不出来。能算的就别交给自觉。
 *
 * 接线现状（别把它读成已经生效）：只有 `formatFilesTxt` 在工具里被调用——`review_scope`
 * 落 files.txt 时用的。`parseCoverage` / `reconcile` / `lintVerdicts` 目前只被测试和
 * `scripts/verify.mjs` 使用，对账还没有生产入口（见 README「这个版本没做的」）。
 * 在真正接进工具之前，「数一遍」仍是技能对模型的要求，不是代码保证。
 */

/** 报告里覆盖表所在的章节标题。模板固定用「2 覆盖清单」。 */
const COVERAGE_HEADING = /^##\s*2\.?\s*覆盖清单/m

/** 表格行：`| 1 | \`path\` | M +12/-3 | ✅ |`。 */
const TABLE_ROW = /^\|(.+)\|\s*$/

function cells(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isEmptyRow(line) {
  return /^\|[\s|:-]+\|?\s*$/.test(line)
}

/** 去掉 Markdown 的反引号与强调符，留下文件名本身。 */
function cleanPath(cell) {
  return cell
    .replace(/[`*]/g, '')
    .replace(/^~~|~~$/g, '')
    .trim()
}

/**
 * 把 preview 的可审文件清单写成 `files.txt` 的内容。
 *
 * 一行一个文件，不写变更量——变更量在报告里重新取，清单只负责「审了哪些」。
 * 多仓时前面带仓库名，用制表符分隔，与 `dsh-snc-dev` 的 files.txt 同形。
 */
export function formatFilesTxt(payload, repoName) {
  const files = Array.isArray(payload?.reviewable_files) ? payload.reviewable_files : []
  return files
    .map((file) => (repoName === undefined ? file.path : `${repoName}\t${file.path}`))
    .join('\n')
}

/** 把 `files.txt` 读回成路径数组。兼容「仓库名\t路径」与「纯路径」两种写法。 */
export function parseFilesTxt(text) {
  if (typeof text !== 'string') return []
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const tab = line.indexOf('\t')
      return tab === -1 ? line : line.slice(tab + 1).trim()
    })
    .filter((line) => line.length > 0)
}

/**
 * 从报告正文里取覆盖表。
 *
 * 只认「## 2 覆盖清单」之后的第一个表格，取第 2 列的路径。返回的 `problems`
 * 是格式问题（缺章节、缺表格、一行写了多个文件），不是覆盖问题——两者要分开报，
 * 否则「格式没写对」会被当成「文件漏审」。
 */
export function parseCoverage(markdown) {
  const problems = []
  if (typeof markdown !== 'string' || markdown.length === 0) {
    return { rows: [], problems: ['报告是空的'] }
  }

  const heading = COVERAGE_HEADING.exec(markdown)
  if (heading === null) return { rows: [], problems: ['找不到「## 2 覆盖清单」章节'] }

  const rest = markdown.slice(heading.index + heading[0].length)
  const lines = rest.split(/\r?\n/)
  const rows = []
  let inTable = false

  for (const raw of lines) {
    const line = raw.trim()

    if (line.startsWith('##')) break
    if (!inTable) {
      if (!line.startsWith('|')) continue
      inTable = true
      continue
    }
    if (line.length === 0) {
      if (rows.length > 0) break
      continue
    }
    if (!line.startsWith('|')) break
    if (isEmptyRow(line)) continue

    const columns = cells(line)
    if (columns.length < 2) {
      problems.push(`覆盖表有一行列数不足：${line.slice(0, 60)}`)
      continue
    }
    // 表头：第一列不是序号。
    if (/^(#|序号)$/.test(columns[0])) continue

    const path = cleanPath(columns[1])
    if (path.length === 0) continue
    if (path.includes('*') || /×|x\s*\d+/i.test(path)) {
      problems.push(`覆盖表里出现通配或合并且记：「${path}」——一行必须对应一个文件`)
      continue
    }
    rows.push({ path, verdict: cleanPath(columns[columns.length - 1]) })
  }

  if (rows.length === 0 && problems.length === 0) problems.push('覆盖表里没有任何文件行')
  return { rows, problems }
}

/**
 * 清单与覆盖表的对账。
 *
 * 三个集合之差就是全部结论：清单里有、表里没有 = 漏审；表里有、清单里没有 =
 * 审了范围外的东西；同一路径出现两次 = 计数虚高。
 */
export function reconcile(scopePaths, coverageRows) {
  const scope = Array.isArray(scopePaths) ? scopePaths : []
  const covered = Array.isArray(coverageRows) ? coverageRows.map((row) => (typeof row === 'string' ? row : row.path)) : []

  const scopeSet = new Set(scope)
  const seen = new Set()
  const duplicated = []
  const extra = []

  for (const path of covered) {
    if (seen.has(path)) duplicated.push(path)
    seen.add(path)
    if (!scopeSet.has(path)) extra.push(path)
  }

  const missing = scope.filter((path) => !seen.has(path))
  return {
    ok: missing.length === 0 && extra.length === 0 && duplicated.length === 0,
    total: scope.length,
    covered: scope.length - missing.length,
    missing,
    extra,
    duplicated,
  }
}

/** 覆盖表结论列只允许三种写法。@returns 违规行的描述，空数组表示合规。 */
export function lintVerdicts(rows) {
  const violations = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const verdict = typeof row.verdict === 'string' ? row.verdict : ''
    if (verdict === '✅') continue
    if (/^⚠️\s*[CHMLI]-\d+/.test(verdict)) continue
    if (/^—\s*未审：\S/.test(verdict)) continue
    violations.push(`${row.path}：结论列写的是「${verdict || '空'}」`)
  }
  return violations
}

/** 取 diff 的命令形状，按 mode 给。模型不用自己拼 ref。 */
export function diffCommands(payload) {
  if (payload?.mode === 'range') {
    const base = payload.merge_base ?? payload.from
    return `git diff ${base}..${payload.to} -- <path>`
  }
  if (payload?.mode === 'commit') {
    return `git show ${payload.commit} -- <path>`
  }
  return 'git diff HEAD -- <path>'
}

/** 工具输出的一行摘要。 */
export function describeScope(payload) {
  if (payload === undefined) return '没有取到范围'
  const target =
    payload.mode === 'range'
      ? `range ${payload.from}..${payload.to}`
      : payload.mode === 'commit'
        ? `commit ${payload.commit}`
        : 'workspace（未提交改动）'
  return `${target}：可审 ${payload.reviewable_count}/${payload.total_files} 个文件，+${payload.total_insertions}/-${payload.total_deletions}，排除 ${payload.excluded_count} 个`
}
