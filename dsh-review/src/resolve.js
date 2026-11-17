/**
 * 找 `opencodereview` 可执行文件。
 *
 * 这是本包唯一依赖外部程序的地方，也是它唯一可能「装好了但跑不起来」的地方，
 * 所以解析顺序写死在这里、可单测，错误信息在 `index.js` 里组装成人能照着做的样子。
 *
 * 不下载、不安装、不联网：ocr 是系统上的一个外部工具，像 git 一样被找到、被调用。
 * 装完之后不需要重启——因为这个函数在**每次调用时**执行，不在挂载时执行。
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir as osHomedir } from 'node:os'

/** 只认文件：目录存在 ≠ 可执行。`~/.dsh/open-code-review` 是目录，直接 spawn 会 ENOENT。 */
function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** 原生二进制的文件名。npm 的 `ocr` 垫片是 Node 脚本，不能 `shell: false` 直接执行。 */
export const BINARY_NAME = process.platform === 'win32' ? 'opencodereview.exe' : 'opencodereview'

/** 上游把二进制拆成按 os/cpu 门控的平台包，后缀与 Node 的 `process.platform/arch` 同形。 */
export function platformPackageName(platform, arch) {
  return `ocr-${platform}-${arch}`
}

/**
 * 一个目录下可能藏着二进制的位置。
 *
 * `node_modules/@alibaba-group/ocr-<平台>` 那条是实际命中的那个：上游把二进制
 * 放在平台包里，`npm install --prefix <dir>` 之后就在这一层。
 */
export function candidatesIn(dir, platform = process.platform, arch = process.arch) {
  if (typeof dir !== 'string' || dir.length === 0) return []
  const pkg = platformPackageName(platform, arch)
  return [
    join(dir, BINARY_NAME),
    join(dir, 'bin', BINARY_NAME),
    join(dir, 'node_modules', '@alibaba-group', pkg, 'bin', BINARY_NAME),
    join(dir, 'node_modules', '@alibaba-group', 'open-code-review', 'node_modules', '@alibaba-group', pkg, 'bin', BINARY_NAME),
  ]
}

/** PATH 里的目录，去掉空项与引号。 */
function pathEntries(env, platform) {
  const raw = env.PATH ?? env.Path ?? ''
  const separator = platform === 'win32' ? ';' : ':'
  return raw
    .split(separator)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter((entry) => entry.length > 0)
}

/** 会把全局包装到哪。`npm i -g` 之后二进制在其中的平台包里。 */
function globalRoots(env, platform, homedir) {
  const roots = []
  if (platform === 'win32') {
    const appData = env.APPDATA ?? join(homedir, 'AppData', 'Roaming')
    roots.push(join(appData, 'npm', 'node_modules'))
  } else {
    roots.push(join('/usr', 'local', 'lib', 'node_modules'))
    roots.push(join('/usr', 'lib', 'node_modules'))
  }
  for (const entry of pathEntries(env, platform)) {
    roots.push(join(entry, 'node_modules'))
  }
  return roots
}

/**
 * 解析出可执行文件。
 *
 * 顺序：显式配置 → 环境变量 → 自己管的落点 → 已知安装目录 → 全局包目录 → PATH。
 * 前面的空着不影响后面的；全空时返回 `missing` 与一份「找过哪里」的清单，
 * 由调用方决定怎么讲给人听。
 *
 * @param options.ocrPath 配置项，可为可执行文件，也可为安装目录
 * @param options.env 环境变量快照
 * @param options.isFile 文件判定，测试时注入
 * @param options.platform/arch/homedir 平台信息，测试时注入
 * @returns {{command: string, source: string} | {missing: string[]}}
 */
export function resolveOcr(options = {}) {
  const {
    ocrPath = '',
    env = process.env,
    isFile: fileCheck = isFile,
    platform = process.platform,
    arch = process.arch,
    homedir = osHomedir(),
  } = options

  const searched = []
  const seen = new Set()

  const tryFile = (file, source) => {
    if (typeof file !== 'string' || file.length === 0) return undefined
    if (seen.has(file)) return undefined
    seen.add(file)
    searched.push(file)
    return fileCheck(file) ? { command: file, source } : undefined
  }

  // 一条路径可能是可执行文件，也可能是安装目录：两种都试，顺序上文件优先。
  const tryPath = (value, source) => {
    if (typeof value !== 'string' || value.trim().length === 0) return undefined
    const direct = tryFile(value.trim(), source)
    if (direct !== undefined) return direct
    for (const candidate of candidatesIn(value.trim(), platform, arch)) {
      const hit = tryFile(candidate, source)
      if (hit !== undefined) return hit
    }
    return undefined
  }

  const explicit = tryPath(ocrPath, 'config.ocrPath')
  if (explicit !== undefined) return explicit

  const fromEnv = tryPath(env.DSH_REVIEW_OCR, 'env.DSH_REVIEW_OCR')
  if (fromEnv !== undefined) return fromEnv

  const dshHome = env.DSH_HOME ?? join(homedir, '.dsh')
  const knownDirs = [
    [join(dshHome, 'dsh-review', 'ocr'), `dshHome/dsh-review/ocr`],
    [join(dshHome, 'open-code-review'), `dshHome/open-code-review`],
  ]
  for (const [dir, source] of knownDirs) {
    const hit = tryPath(dir, source)
    if (hit !== undefined) return hit
  }

  for (const root of globalRoots(env, platform, homedir)) {
    const hit = tryPath(join(root, '@alibaba-group', 'open-code-review'), 'npm global')
    if (hit !== undefined) return hit
  }

  for (const entry of pathEntries(env, platform)) {
    for (const name of ['opencodereview', 'ocr']) {
      const file = join(entry, platform === 'win32' ? `${name}.exe` : name)
      const hit = tryFile(file, 'PATH')
      if (hit !== undefined) return hit
    }
  }

  return { missing: searched }
}

/** 解析 `ocr version` 的首行，取 `MAJOR.MINOR.PATCH`。 */
export function parseVersion(banner) {
  if (typeof banner !== 'string') return undefined
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(banner)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** `delegate --format json` 自 1.9.0 起可用。低于这个版本时报「太旧」，不报「解析失败」。 */
export const MINIMUM_VERSION = [1, 9, 0]

export function supportsJson(version) {
  if (version === undefined) return false
  const [major, minor] = version
  const [floorMajor, floorMinor] = MINIMUM_VERSION
  return major > floorMajor || (major === floorMajor && minor >= floorMinor)
}
