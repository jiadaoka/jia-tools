/**
 * 内核：纯函数判定。
 *
 * 这里没有文件系统、没有网络、没有时间。所有输入都是字符串或对象，
 * 所有输出都是可判定的值。所以它可以被直接单测——而规则会频繁改，
 * 装配很少改，混在一起的结果是每改一条规则都要跑一遍端到端。
 */

/** 会执行任意命令的工具。其余工具不进门禁。 */
export const SHELL_TOOLS = new Set(['bash', 'pwsh', 'win_bash', 'shell', 'terminal'])

/** 会落盘的工具，以及它们参数里表示路径的键。 */
export const WRITE_TOOLS = new Set(['write', 'edit'])
const PATH_KEYS = ['file_path', 'path', 'target']

/**
 * `git` 之后跳过全局选项（`-C <path>` / `-c k=v` / `--no-pager`）再看子命令。
 * 这样 `git -C sub commit` 会被判出来，`git log --grep=commit` 不会。
 */
const GIT_WRITE =
  /^git\s+(?:(?:-[Cc]\s+\S+|--?\S+)\s+)*(commit|push|revert|rebase|merge|cherry-pick|reset|restore|checkout|switch|clean)\b/

/** 删除类操作单独判：`git branch` 是只读的，`git branch -D` 不是。 */
const GIT_DESTRUCTIVE =
  /^git\s+(?:(?:-[Cc]\s+\S+|--?\S+)\s+)*(branch\s+(?:-[dD]|--delete)|tag\s+(?:-d|--delete)|stash\s+(?:drop|clear))\b/

/** 密钥、凭据、环境变量的落盘位置。 */
const SENSITIVE_TARGET =
  /(?:^|[\\/])(?:\.env(?:\.[\w-]+)?|\.npmrc|\.pypirc|id_[rd]sa|credentials\.(?:json|ya?ml)|secrets?\.(?:json|ya?ml|txt))$|\.(?:pem|key|p12|pfx)$/i

/** 模板文件不是凭据，放行。 */
const TEMPLATE_SUFFIX = /\.(?:example|sample|template|dist)$/i

/**
 * 从命令文本里找出真正会被执行的那一段版本控制写操作。
 *
 * 按 `&&`、`||`、`;`、换行切段，每段的第一个词必须是 `git`——所以
 * `echo "git commit"` 里出现在引号内的文字不算命令，注释也不算。
 *
 * @returns 命中的那一段，或 undefined
 */
export function inspectCommand(text) {
  if (typeof text !== 'string') return undefined
  for (const raw of text.split(/&&|\|\||;|\n/)) {
    const segment = raw.trim().replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, '')
    if (!/^git\s/.test(segment)) continue
    if (GIT_WRITE.test(segment) || GIT_DESTRUCTIVE.test(segment)) return segment
  }
  return undefined
}

/** 写入目标是否为不该进仓库的敏感位置。 */
export function isSensitiveTarget(target) {
  if (typeof target !== 'string' || target.length === 0) return false
  if (TEMPLATE_SUFFIX.test(target)) return false
  return SENSITIVE_TARGET.test(target)
}

function readArgument(args, keys) {
  if (typeof args !== 'object' || args === null) return undefined
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * 裁定一次工具调用。
 *
 * 只返回两种结果：拒绝理由，或 undefined（放行）。
 * 没有「警告」态——门禁只有两态，需要提醒的东西不该做成门禁。
 *
 * @param execution 工具名与参数
 * @param env 环境变量快照，用于总开关
 * @returns 拒绝理由，或 undefined
 */
export function judge(execution, env = {}) {
  if (env.DSH_DEV_GUARD === 'off') return undefined

  const { name, arguments: args } = execution

  if (SHELL_TOOLS.has(name)) {
    const command = readArgument(args, ['command', 'cmd', 'script'])
    const hit = inspectCommand(command)
    if (hit === undefined) return undefined
    return [
      '工程纪律（dsh-dev）：不代跑版本控制写操作。',
      `命中的命令：${hit}`,
      '把命令起草出来交给开发者执行；要提交信息时加载 dev-git-commit 生成草稿，不要自己跑。',
      '本次确需放行：环境变量 DSH_DEV_GUARD=off，重启生效。',
    ].join('\n')
  }

  if (WRITE_TOOLS.has(name)) {
    const target = readArgument(args, PATH_KEYS)
    if (!isSensitiveTarget(target)) return undefined
    return [
      '工程纪律（dsh-dev）：这个位置的凭据不进仓库。',
      `命中的路径：${target}`,
      '凭据由开发者自己贴，或写进被忽略的本地文件；仓库里只保留 *.example 模板。',
    ].join('\n')
  }

  return undefined
}
