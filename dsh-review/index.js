/**
 * dsh-review — 读代码时的纪律。
 *
 * 分工是刻意的：**不能出错的部分交给 ocr**（哪些文件在范围内、每个文件适用哪些规则），
 * **判断与产出归本包**（怎么审、怎么写报告、怎么对账）。
 *
 * ocr 是外部工具，不是本包的依赖：不下载、不安装、不联网，每次调用时按
 * `src/resolve.js` 的顺序去找。所以装完 ocr 不必重启，配一个路径就能换版本。
 *
 * 装配是这里唯一有副作用的地方：解析在 `src/resolve.js`，契约在 `src/delegate.js`，
 * 对账在 `src/report.js`，都是纯函数，可以单测。
 */

import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCatalog, PROVIDER_NAME, toCandidate, toDefinition } from './src/catalog.js'
import { buildPreviewArgs, buildRulesArgs, parseDelegate, runOcr } from './src/delegate.js'
import { formatFilesTxt, describeScope, diffCommands } from './src/report.js'
import { MINIMUM_VERSION, parseVersion, resolveOcr, supportsJson } from './src/resolve.js'

export { PROVIDER_NAME }

export const name = 'dsh-review'
export const inject = ['tools', 'skills']

export const SKILLS_ROOT = fileURLToPath(new URL('./skills/', import.meta.url))
export const PACKAGE_ROOT = fileURLToPath(new URL('./', import.meta.url))

/** 常驻提示的位置：人格之后（0），计划策略之前（500）。 */
const SECTION_NAME = 'review:discipline'
const SECTION_ORDER = 120

/** 审查产物落在被审仓库的哪个子目录。不写进代码目录，也不写进仓库根。 */
const REVIEW_DIR = '.review'

/** 单次 scope 输出里最多列多少个文件；超出的只给清单路径，避免工具输出淹掉上下文。 */
const MAX_LISTED = 80

export function readResident() {
  const file = new URL('./prompt.md', import.meta.url)
  try {
    return readFileSync(file, 'utf8').trim()
  } catch (error) {
    throw new Error(`dsh-review: 读不到常驻提示 prompt.md（${fileURLToPath(file)}）：${error.message}`)
  }
}

/**
 * 归一化配置。
 *
 * 不声明 schemastery 的 Config：本包只想要两个值，为此引入一个必须由宿主提供的
 * peer 不值得。默认值写在代码里，``cordis.patch.yml`` 里不配也能跑；
 * 环境变量作为第二条覆盖通道，用于「不想改 profile 只想临时换一个 ocr」。
 */
export function normalizeConfig(config = {}, env = {}) {
  const ocrPath = typeof config?.ocrPath === 'string' && config.ocrPath.length > 0 ? config.ocrPath : (env.DSH_REVIEW_OCR ?? '')
  const rawTimeout = config?.timeoutMs ?? env.DSH_REVIEW_TIMEOUT_MS
  const timeoutMs = Number.isFinite(Number(rawTimeout)) && Number(rawTimeout) > 0 ? Number(rawTimeout) : 180_000
  return { ocrPath, timeoutMs }
}

/** 会话工作目录：没有 cwd 时退回进程目录。 */
function resolveRepo(requested, exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof requested === 'string' && requested.length > 0) {
    if (isAbsolute(requested)) return requested
    return cwd === undefined ? requested : resolve(cwd, requested)
  }
  return cwd ?? process.cwd()
}

/** `LOCAL-<仓库名>-<yyyyMMddHHmm>`，与审查单元目录的命名约定一致。 */
export function unitName(repo, now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
  const bare = basename(repo).replace(/[\\/:*?"<>|]/g, '-') || 'repo'
  return `LOCAL-${bare}-${stamp}`
}

/** 找不到 ocr 时要说的话。三件事缺一不可：找过哪里、装什么、装完怎么办。 */
export function missingOcrMessage(searched) {
  const tried = searched.length === 0 ? '  （没有可尝试的路径）' : searched.map((path) => `  ${path}`).join('\n')
  return [
    '没有找到 Open Code Review 可执行文件（需要 1.9.0 以上，用于 --format json）。',
    '',
    '找过：',
    tried,
    '',
    '装一条即可：',
    '  npm install --prefix "%USERPROFILE%\\.dsh\\open-code-review" @alibaba-group/open-code-review',
    '  npm install -g @alibaba-group/open-code-review',
    '',
    '装完不需要重启：下次调用会重新解析。装在别处就在 profile 的 cordis.patch.yml 里写：',
    '- id: review-discipline',
    '  config:',
    '    ocrPath: D:\\tools\\opencodereview.exe',
  ].join('\n')
}

/** 版本闸。低于地板时报「太旧」，不报「解析失败」——两者混在一起最费时间。 */
function tooOldMessage(banner, command) {
  const version = parseVersion(banner)
  return [
    `Open Code Review 版本太旧：${version === undefined ? '读不出版本' : version.join('.')}（${command}）`,
    `--format json 需要 ${MINIMUM_VERSION.join('.')} 及以上。`,
    '升级：npm install -g @alibaba-group/open-code-review',
    banner === undefined ? '' : `原始输出：${banner.split(/\r?\n/)[0]}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

/**
 * 工具定义的输出形状。
 *
 * 不用 `defineTool`：它来自 `@deepseek-ai/dsh-tools`，而本包是用 `link:` 装进 profile 的，
 * 插件模块的 realpath 在 jia-tools 下，宿主那个包解析不到——实测挂载会 `failed to import`。
 * `tools.register()` 要的就是这份 JSON Schema 形状，手写即可，与转换结果同形。
 */
const OUTPUT_SHAPE = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: '一行摘要，可安全引用。' },
    output: { type: 'string', description: '完整正文，含清单与命令。' },
  },
  required: ['headline', 'output'],
}

const render = (_args, value) => [{ type: 'text', text: `${value.headline}\n\n${value.output}` }]

/**
 * 版本按「路径 + 文件指纹」缓存。
 *
 * 只按路径缓存，遇到原地升级（`npm i -g` 覆盖同一个可执行文件）会一直报旧版本——
 * 而升级恰恰是版本闸最该重新判断的时刻。加上 mtime 与大小，覆盖写就会让缓存失效。
 */
function stampOf(command) {
  try {
    const stats = statSync(command)
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return ''
  }
}

export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config, process.env)
  const catalog = createCatalog(SKILLS_ROOT)

  const versionCache = new Map()

  /**
   * 每次调用都重新解析，不在挂载时缓存。
   * 这样「装完 ocr 再试一次」立刻有效，也让 ocrPath 的改动不必重启 profile。
   */
  const locate = () => resolveOcr({ ocrPath: settings.ocrPath, env: process.env })

  async function versionOf(command, signal) {
    const stamp = stampOf(command)
    const hit = versionCache.get(command)
    if (hit !== undefined && hit.stamp === stamp) return hit.banner
    const stdout = await runOcr(['version'], { command, cwd: process.cwd(), timeoutMs: 30_000, signal })
    const first = stdout.split(/\r?\n/)[0] ?? ''
    versionCache.set(command, { stamp, banner: first })
    return first
  }

  /** 解析 + 版本闸。失败返回可直接展示的正文，而不是抛异常。 */
  async function ensureReady(signal) {
    const located = locate()
    if (located.missing !== undefined) {
      return { error: missingOcrMessage(located.missing) }
    }
    let banner
    try {
      banner = await versionOf(located.command, signal)
    } catch (error) {
      return { error: `ocr 找到了但跑不起来：${located.command}\n${error.message}` }
    }
    if (!supportsJson(parseVersion(banner))) {
      return { error: tooOldMessage(banner, located.command) }
    }
    return { command: located.command, source: located.source, banner }
  }

  ctx.skills.registerProvider((control) => {
    let watcher
    try {
      watcher = watch(SKILLS_ROOT, { recursive: true }, () => {
        // 保存过程中那半秒的 frontmatter 是坏的，解析会抛错；这里跑在 fs.watch
        // 回调里，抛出去就是未捕获异常，会把宿主进程带走。沿用上一份，等下次改动再试。
        try {
          catalog.reload()
        } catch (error) {
          ctx.logger?.warn?.(`dsh-review: 技能重载失败，沿用上一份（${error.message}）`)
          return
        }
        control.invalidate()
      })
      watcher.on('error', () => {})
      // 监听不该成为进程退出的阻碍（测试里尤其明显）。
      watcher.unref?.()
    } catch {
      watcher = undefined
    }
    control.signal.addEventListener('abort', () => watcher?.close(), { once: true })

    return {
      name: PROVIDER_NAME,
      async list() {
        return catalog.all().map(toCandidate)
      },
      async get(candidate) {
        const skill = catalog.all().find((entry) => entry.name === candidate.name)
        return skill === undefined ? undefined : toDefinition(skill)
      },
    }
  })

  const prompt = ctx.get('systemPrompt')
  if (prompt !== undefined) {
    prompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: readResident() })
  }

  const ready = (exec) => ensureReady(exec?.signal)

  ctx.tools.register({
    name: 'review_scope',
    description:
      '取一次代码审查的范围：哪些改动文件可审、哪些被排除及原因、取 diff 该用什么命令。' +
      '范围由 Open Code Review 判定，不是模型猜的。同时把清单落到 <repo>/.review/<单元>/files.txt，' +
      '报告里的覆盖表必须与它逐行对应。审查代码前先调它；只读代码、不做审查时不用。',
    parameters: {
      type: 'object',
      properties: {
        commit: { type: 'string', description: '审单个提交（与父提交比）。不能与 from/to 同用。' },
        from: { type: 'string', description: '分支对比的起点 ref，必须与 to 成对。' },
        to: { type: 'string', description: '分支对比的终点 ref，必须与 from 成对。' },
        exclude: { type: 'string', description: '逗号分隔的 gitignore 风格排除，与规则自带的排除合并。' },
        background: { type: 'string', description: '需求背景。量大时改用 backgroundFile。' },
        backgroundFile: { type: 'string', description: '背景 Markdown 路径，相对路径按仓库根解析。' },
        repo: { type: 'string', description: '要审查的仓库。默认当前会话工作目录。' },
        unit: { type: 'string', description: '审查单元名。默认 LOCAL-<仓库名>-<时间戳>。' },
      },
    },
    output: { schema: OUTPUT_SHAPE, render },
    async execute(args, exec) {
        const argv = buildPreviewArgs(args)
        const repo = resolveRepo(args.repo, exec)
        const readyState = await ready(exec)
        if (readyState.error !== undefined) {
          return { headline: 'Open Code Review 不可用。', output: readyState.error }
        }

        const stdout = await runOcr([...argv, '--repo', repo], {
          command: readyState.command,
          cwd: repo,
          timeoutMs: settings.timeoutMs,
          signal: exec?.signal,
        })
        const payload = parseDelegate(stdout, 'preview')

        const unit = typeof args.unit === 'string' && args.unit.length > 0 ? args.unit : unitName(repo)
        const filesTxt = formatFilesTxt(payload)
        const listed = payload.reviewable_files.slice(0, MAX_LISTED)
        const rest = payload.reviewable_files.length - listed.length

        let manifestLine
        try {
          const dir = join(repo, REVIEW_DIR, unit)
          mkdirSync(dir, { recursive: true })
          writeFileSync(join(dir, 'files.txt'), filesTxt.length === 0 ? '' : `${filesTxt}\n`, 'utf8')
          manifestLine = `清单：${join(dir, 'files.txt')}（${payload.reviewable_files.length} 行）`
        } catch (error) {
          manifestLine = `清单：未能落盘（${error.message}），以下正文即为清单`
        }

        const excluded = payload.excluded_files
        const reasons = new Map()
        for (const file of excluded) {
          const reason = file.exclude_reason ?? 'unspecified'
          reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
        }

        const body = [
          `范围：${describeScope(payload)}`,
          `仓库：${payload.repository}（${payload.mode}）`,
          manifestLine,
          `取 diff：${diffCommands(payload)}`,
          payload.mode === 'commit' && payload.commit !== undefined
            ? `提交：${payload.commit}${payload.background === undefined ? '' : '（附提交信息，可作为审查背景）'}`
            : undefined,
          payload.mode === 'range' ? `merge-base：${payload.merge_base ?? '(未给出)'}` : undefined,
          '',
          payload.reviewable_files.length === 0
            ? '可审文件：无（改动为空，或全部被排除）'
            : `可审文件（${payload.reviewable_files.length}）：\n${listed
                .map((file, index) => `${index + 1}. ${file.path} [${file.status}] +${file.insertions}/-${file.deletions}`)
                .join('\n')}${rest > 0 ? `\n…还有 ${rest} 个，见清单文件` : ''}`,
          '',
          excluded.length === 0
            ? '排除：无'
            : `排除 ${excluded.length} 个（${[...reasons].map(([reason, count]) => `${reason} ${count}`).join('，')}）`,
          '',
          `ocr：${readyState.banner.split(/\r?\n/)[0]} · 解析自 ${readyState.source}`,
        ]
          .filter((line) => line !== undefined)
          .join('\n')

        return { headline: describeScope(payload), output: body }
      },
    presentCall: (args) => ({
      card: 'generic',
      title: '审查：取范围',
      kind: 'other',
      rawInput: args,
    }),
  })

  ctx.tools.register({
    name: 'review_rules',
    description:
      '取这批文件适用的审查规则：按规则正文分组，共用同一规则的文件只出现一次。' +
      '规则正文就是审查清单，读代码之前先读它。路径取自 review_scope 报的可审文件。',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: '可审文件路径，相对仓库根，与 review_scope 报的一致。',
        },
        repo: { type: 'string', description: '这些路径所属的仓库。默认当前会话工作目录。' },
        rule: { type: 'string', description: '自定义规则 JSON 文件路径（相对仓库根）。' },
      },
      required: ['paths'],
    },
    output: { schema: OUTPUT_SHAPE, render },
    async execute(args, exec) {
      const argv = buildRulesArgs(args)
      const repo = resolveRepo(args.repo, exec)
      const readyState = await ready(exec)
      if (readyState.error !== undefined) {
        return { headline: 'Open Code Review 不可用。', output: readyState.error }
      }

      const stdout = await runOcr([...argv, '--repo', repo], {
        command: readyState.command,
        cwd: repo,
        timeoutMs: settings.timeoutMs,
        signal: exec?.signal,
      })
      const payload = parseDelegate(stdout, 'rule')
      const groups = Array.isArray(payload.groups) ? payload.groups : []

      const body = groups
        .map((group) => {
          const files = Array.isArray(group.files) ? group.files : []
          return [
            `### 规则组 ${group.group_id}（${group.source}）· ${group.pattern ?? '按路径'}`,
            `适用 ${files.length} 个文件：${files.map((file) => `\`${file}\``).join(', ')}`,
            '',
            typeof group.rule === 'string' ? group.rule.trim() : '（这一组没有规则正文）',
          ].join('\n')
        })
        .join('\n\n---\n\n')

      const sources = [...new Set(groups.map((group) => group.source).filter(Boolean))]
      return {
        headline: `${groups.length} 组规则，覆盖 ${args.paths.length} 个文件（来源：${sources.join(', ') || '无'}）`,
        output: body.length === 0 ? '没有解析到任何规则。' : body,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `审查：取规则（${args.paths?.length ?? 0} 个文件）`,
      kind: 'other',
      rawInput: args,
    }),
  })

  // 技能目录被监听，改完条款不必重启。目录不存在时上面已经抛过，这里只留一条日志。
  if (!existsSync(SKILLS_ROOT)) {
    ctx.logger?.warn?.(`dsh-review: 技能目录不存在：${SKILLS_ROOT}`)
  }
}

// 供测试使用：不通过宿主也能算一次真实输出。
export { parseVersion, supportsJson }
export const __internal = { REVIEW_DIR, MAX_LISTED }
