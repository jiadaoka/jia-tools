/**
 * 与 `ocr delegate` 的接触面：参数、输出解析、进程。
 *
 * 前两件是纯函数（可单测），第三件是这里唯一碰系统的地方。
 * 契约来自实测：成功时 stdout 是一份 JSON，失败时 exit 1、stderr 一行 `Error: ...`、
 * stdout 为空。所以「解析失败」和「命令失败」必须分开报，否则最该修的那个错会被掩盖。
 */

import { spawn } from 'node:child_process'

/** stdout 上限。超了就当异常处理——正常一次审查不会输出这么多。 */
const OUTPUT_LIMIT = 10 * 1024 * 1024

/** 拒绝理由的原文截断长度，够看出是什么错，又不至于把日志塞满。 */
const RAW_PREVIEW = 400

export class OcrExecutionError extends Error {
  constructor(message, { stderr, stdout, command } = {}) {
    super(message)
    this.name = 'OcrExecutionError'
    this.stderr = stderr
    this.stdout = stdout
    this.command = command
  }
}

export class DelegateParseError extends Error {
  constructor(message, { raw } = {}) {
    super(message)
    this.name = 'DelegateParseError'
    this.raw = raw
  }
}

/**
 * 构造 `delegate preview` 的参数（不含 `--repo`，由调用方补）。
 *
 * 三种取范围的方式互斥，这里就地拒绝——让模型早一步拿到「参数不对」，
 * 而不是等 ocr 报一句 `--from value ... is not a valid commit ref`。
 */
export function buildPreviewArgs(input = {}) {
  const { commit, from, to, exclude, background, backgroundFile, rule } = input
  const has = (value) => typeof value === 'string' && value.trim().length > 0

  if (has(commit) && (has(from) || has(to))) {
    throw new Error('commit 不能与 from/to 同时使用')
  }
  if (has(from) !== has(to)) {
    throw new Error('from 与 to 必须成对出现')
  }
  if (has(background) && has(backgroundFile)) {
    throw new Error('background 与 backgroundFile 只能给一个')
  }

  const args = ['delegate', 'preview', '--format', 'json']
  if (has(commit)) args.push('--commit', commit.trim())
  if (has(from)) args.push('--from', from.trim(), '--to', to.trim())
  if (has(exclude)) args.push('--exclude', exclude.trim())
  if (has(background)) args.push('--background', background)
  if (has(backgroundFile)) args.push('--background-file', backgroundFile.trim())
  if (has(rule)) args.push('--rule', rule.trim())
  return args
}

/** 构造 `delegate rule` 的参数。路径顺序保留，输出按规则正文分组，与顺序无关。 */
export function buildRulesArgs(input = {}) {
  const paths = Array.isArray(input.paths) ? input.paths.filter((path) => typeof path === 'string' && path.length > 0) : []
  if (paths.length === 0) throw new Error('paths 不能为空')
  const args = ['delegate', 'rule', '--format', 'json']
  for (const path of paths) args.push(path)
  if (typeof input.rule === 'string' && input.rule.trim().length > 0) args.push('--rule', input.rule.trim())
  return args
}

/**
 * 从 stdout 里取出 JSON。
 *
 * 不假设「整段就是 JSON」：上游可能在前面打日志、在末尾留空行。取第一个 `{`
 * 到最后一个 `}` 之间，比要求 stdout 纯净更耐用。
 */
export function parseDelegate(stdout, kind) {
  if (typeof stdout !== 'string' || stdout.trim().length === 0) {
    throw new DelegateParseError('ocr 没有输出任何内容', { raw: '' })
  }
  const text = stdout.replace(/^\uFEFF/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new DelegateParseError('ocr 的输出里没有 JSON 对象', { raw: text.slice(0, RAW_PREVIEW) })
  }

  let payload
  try {
    payload = JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    throw new DelegateParseError(`ocr 输出不是合法 JSON：${error.message}`, {
      raw: text.slice(0, RAW_PREVIEW),
    })
  }

  const required = kind === 'rule' ? ['groups'] : ['mode', 'reviewable_files', 'excluded_files']
  for (const key of required) {
    if (payload[key] === undefined) {
      throw new DelegateParseError(`ocr 的 JSON 缺少字段 "${key}"（schema_version=${payload.schema_version ?? '缺失'}）`, {
        raw: text.slice(0, RAW_PREVIEW),
      })
    }
  }
  return payload
}

/** 在 Windows 上杀掉整棵进程树。`child.kill` 只杀直接子进程，ocr 会留下 git 子进程占着索引锁。 */
function killTree(child) {
  if (child.exitCode !== null || child.killed) return
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      return
    } catch {
      // taskkill 不可用时退回普通 kill，总比什么都不做强。
    }
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // 进程已经退出。
  }
}

/**
 * 执行一次 ocr 调用。
 *
 * @param argv 子命令与其参数
 * @param options.command 可执行文件绝对路径
 * @param options.cwd 工作目录（仓库根）
 * @param options.timeoutMs 墙钟上限
 * @param options.signal 取消信号（会话中断时触发）
 * @returns 原始 stdout
 */
export function runOcr(argv, options = {}) {
  const { command, cwd, timeoutMs = 180_000, signal } = options

  return new Promise((resolve, reject) => {
    let settled = false
    let timer

    const finish = (fn) => (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener?.('abort', onAbort)
      fn(value)
    }
    const ok = finish(resolve)
    const fail = finish(reject)

    const child = spawn(command, argv, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const chunks = []
    let size = 0
    let overflow = false

    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > OUTPUT_LIMIT) {
        overflow = true
        killTree(child)
        return
      }
      chunks.push(chunk)
    })

    const errors = []
    child.stderr.on('data', (chunk) => {
      if (errors.length < 64) errors.push(chunk)
    })

    function onAbort() {
      killTree(child)
      fail(new OcrExecutionError('调用被取消', { command }))
    }

    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    timer = setTimeout(() => {
      killTree(child)
      fail(
        new OcrExecutionError(
          `ocr 超过 ${Math.round(timeoutMs / 1000)} 秒没有返回（大仓库首次解析会慢，可用 timeoutMs 放宽）`,
          { command },
        ),
      )
    }, timeoutMs)

    child.on('error', (error) => {
      fail(new OcrExecutionError(`无法启动 ocr（${command}）：${error.message}`, { command }))
    })

    child.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
      const stderr = Buffer.concat(errors).toString('utf8').trim()

      if (overflow) {
        fail(new OcrExecutionError(`ocr 输出超过 ${OUTPUT_LIMIT / 1024 / 1024} MiB，已终止`, { command }))
        return
      }
      if (code !== 0) {
        fail(new OcrExecutionError(stderr || `ocr 退出码 ${code}`, { stderr, stdout, command }))
        return
      }
      ok(stdout)
    })
  })
}
