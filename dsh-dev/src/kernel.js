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
export const WRITE_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])
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

/**
 * 包管理器写在脚本名之前的位置选项：`pnpm -C app build`、`yarn --cwd web test`。
 * 不认它们，`-C` 一加就绕过去了。
 */
const LOCATE = String.raw`(?:(?:-C|--prefix|--dir|--cwd|-w|--workspace|--filter|-F)\s+\S+\s+)*`

/** 脚本名里出现就算构建的词。`dev`、`install`、`preview` 故意不在其中。 */
const SCRIPT = String.raw`build|dist|bundle|package|compile|test|typecheck|type-check|check|lint|verify`

/** 平时靠 `npx` 之类临时执行器才跑得到的构建与测试工具。 */
const BUILDER = String.raw`tsc|vue-tsc|svelte-check|vite|webpack|rollup|esbuild|jest|vitest|mocha|ava|playwright|cypress|next|nuxt|astro|parcel|ng|turbo|nx`

/**
 * 构建、打包、编译、测试类命令。
 *
 * 这些会写产物、占 CPU、改快照，而且「跑通了吗」这个判断属于开发者。
 * 只认命令开头的包管理器脚本或构建器本身：`npm run dev` 不是构建，
 * `npm install` 也不是，`vite` 单跑是 dev server。
 */
const BUILD_COMMAND = new RegExp(
  [
    // npm run build / pnpm -C app test / yarn --cwd web typecheck
    `^(?:npm|pnpm|yarn|bun)\\s+${LOCATE}(?:run(?:-script)?\\s+)?(?:${SCRIPT})[\\w:-]*\\b`,
    // 直接调构建器
    `^(?:vite\\s+build|webpack|rollup\\s+-c|esbuild|tsc|vue-tsc|svelte-check|next\\s+build|nuxt\\s+(?:build|generate)|ng\\s+build|astro\\s+build|parcel\\s+build)\\b`,
    // npx tsc / pnpm dlx vite / bunx vitest：个人项目里最常见的「顺手验一下」
    `^(?:npx|pnpx|bunx|npm\\s+exec|pnpm\\s+dlx)\\s+(?:--?\\S+\\s+)*(?:${BUILDER})\\b`,
    // monorepo 编排器直调：`turbo run build`、`nx build app`、`nx run web:test`。
    // 它们只编排构建与测试，没有 dev server 形态，所以直调也算构建；
    // `nx g`、`turbo prune` 这类不含构建词的目标不受影响。
    `^(?:turbo|nx)\\s+(?:run\\s+)?[\\w:-]*(?:${SCRIPT})[\\w:-]*\\b`,
    // 其他语言的构建与测试
    `^(?:\\./)?(?:go\\s+(?:build|test|vet)|cargo\\s+(?:build|test|check|clippy)|mvn\\w*\\s+(?:package|install|test|verify|compile)|gradlew?\\s+(?:build|test|assemble|check)|make\\b|pytest|jest|vitest|mocha|node\\s+--test)\\b`,
  ].join('|'),
)

/** `bash -c "…"` / `pwsh -NoProfile -Command "…"` 的外壳。 */
const SHELL_WRAPPER = /^(?:bash|sh|zsh|dash|pwsh|powershell)(?:\s+-\S+)*\s+-(?:c|command)\s+([\s\S]+)$/i

/** `cmd /c …` 的外壳。 */
const CMD_WRAPPER = /^cmd(?:\.exe)?\s+\/c\s+([\s\S]+)$/i

/**
 * 剥掉一层 shell 外壳，拿到真正会被执行的命令。
 *
 * 包一层 `bash -c` 不改变命令的性质：它仍然是构建，仍然占用户的 CPU。
 * 递归深度在 `commandSegments` 里封顶，避免构造出来的嵌套拖死判定。
 */
function unwrapShell(segment) {
  const match = SHELL_WRAPPER.exec(segment) ?? CMD_WRAPPER.exec(segment)
  if (match === null) return undefined
  let inner = match[1].trim()
  const quote = inner[0]
  // 只取到配对的收尾引号：`bash -c "npm run build" --flag` 后面还挂着参数，
  // 用「整段以引号收尾」判断会漏掉这一种。
  if (quote === '"' || quote === "'") {
    const close = inner.indexOf(quote, 1)
    if (close > 0) inner = inner.slice(1, close).trim()
  }
  return inner.length === 0 ? undefined : inner
}

/**
 * 命令前缀：环境变量赋值、`sudo`、`env`、`command`。
 *
 * 它们不改变命令的性质——`CI=1 npm run build` 和 `sudo npm run build` 都还是构建。
 * 只剥一层不算完：`CI=1 sudo npm run build` 要连剥两次，所以循环剥到底。
 */
const PREFIX = /^(?:(?:[A-Za-z_]\w*=\S*)|sudo|env|command)(?:\s+|$)/

function stripPrefix(segment) {
  let rest = segment
  let hit
  while ((hit = PREFIX.exec(rest)) !== null) rest = rest.slice(hit[0].length)
  return rest.trim()
}

/**
 * 把命令文本切成真正独立执行的段。
 *
 * 先按 `&&`、`||`、`;`、换行切，每段的第一个词必须是命令本身——
 * 所以 `echo "git commit"` 里引号内的文字不算命令。再对剥得开的段
 * 递归进去，`bash -c "npm run build"` 与直接写 `npm run build` 等价。
 */
function* commandSegments(text, depth = 0) {
  if (typeof text !== 'string' || depth > 3) return
  for (const raw of text.split(/&&|\|\||;|\n/)) {
    const segment = stripPrefix(raw.trim())
    if (segment.length === 0) continue
    yield segment
    const inner = unwrapShell(segment)
    if (inner !== undefined) yield* commandSegments(inner, depth + 1)
  }
}

/** 密钥、凭据、环境变量的落盘位置。 */
const SENSITIVE_TARGET =
  /(?:^|[\\/])(?:\.env(?:\.[\w-]+)?|\.npmrc|\.pypirc|id_[rd]sa|credentials\.(?:json|ya?ml)|secrets?\.(?:json|ya?ml|txt))$|\.(?:pem|key|p12|pfx)$/i

/** 模板文件不是凭据，放行。 */
const TEMPLATE_SUFFIX = /\.(?:example|sample|template|dist)$/i

/**
 * 从命令文本里找出真正会被执行的那一段版本控制写操作。
 *
 * @returns 命中的那一段，或 undefined
 */
export function inspectCommand(text) {
  for (const segment of commandSegments(text)) {
    if (!/^git\s/.test(segment)) continue
    if (GIT_WRITE.test(segment) || GIT_DESTRUCTIVE.test(segment)) return segment
  }
  return undefined
}

/**
 * 从命令文本里找出构建、打包、编译或测试的那一段。
 *
 * 与版本控制写操作同一套切段规则：`npx tsc`、`pnpm -C app build`、
 * `bash -c "npm run build"` 都按同一条命令判。
 *
 * @returns 命中的那一段，或 undefined
 */
export function inspectBuild(text) {
  for (const segment of commandSegments(text)) {
    if (BUILD_COMMAND.test(segment)) return segment
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
    if (hit !== undefined) {
      return [
        '工程纪律（dsh-dev）：不代跑版本控制写操作。',
        `命中的命令：${hit}`,
        '把命令起草出来交给开发者执行；要提交信息时加载 dev-git-commit 生成草稿，不要自己跑。',
        '本次确需放行：环境变量 DSH_DEV_GUARD=off，重启生效。',
      ].join('\n')
    }

    const build = inspectBuild(command)
    if (build !== undefined) {
      return [
        '工程纪律（dsh-dev）：构建、打包、测试由开发者发起。',
        `命中的命令：${build}`,
        '写完代码就停手，把待跑命令和各自会产出什么列清楚交回去（见 dev-verify-on-request）。',
        '本次确需放行：环境变量 DSH_DEV_GUARD=off，重启生效。',
      ].join('\n')
    }

    return undefined
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
