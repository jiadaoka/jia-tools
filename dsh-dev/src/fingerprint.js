/**
 * 指纹：从工作目录推导「这是谁」。
 *
 * 判定与读取分开。`fingerprintFrom` 是纯函数，输入是一组文件内容快照，
 * 所以身份规则可以单测；`readFingerprint` 只负责把目录读成快照。
 *
 * 多源识别，任一命中即可：只用目录名判断，会在换机器、改包名、符号链接
 * 之后错判；只用远端地址判断，在没有远端的本地仓库上失效。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 向上找几层。超过这个深度的仓库基本不是当前工作目标。 */
const MAX_DEPTH = 8

/** 标记文件 → 它代表的技术栈。文件存在即可，不需要读内容。 */
const MARKERS = {
  'go.mod': 'go',
  'Cargo.toml': 'rust',
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'build.gradle.kts': 'java',
  Gemfile: 'ruby',
  'composer.json': 'php',
}

/** 依赖名 → 技术栈。只收「出现即说明栈」的包，不收通用工具。 */
const DEPENDENCIES = {
  vue: 'vue',
  'vue-router': 'vue',
  '@vue/cli-service': 'vue',
  nuxt: 'nuxt',
  react: 'react',
  'react-dom': 'react',
  next: 'next',
  svelte: 'svelte',
  '@sveltejs/kit': 'svelte',
  '@angular/core': 'angular',
  typescript: 'ts',
}

/**
 * 从 `git config` 文本里取仓库名。
 *
 * 只取最后一段：`repo-<名字>-*` 的声明需要的是名字，不是 owner。
 * 形如 `git@github.com:jiadaoka/jia-tools.git` 或 `https://host/a/b`。
 */
export function repoOf(gitConfig) {
  if (typeof gitConfig !== 'string') return undefined
  const match = /^\s*url\s*=\s*(\S+)\s*$/m.exec(gitConfig)
  if (match === null) return undefined
  const path = match[1].replace(/\.git$/, '').replace(/\/+$/, '')
  return path.split(/[\\/:]/).filter(Boolean).pop()
}

/**
 * 由文件快照推导身份。纯函数：同一份快照永远得到同一个身份。
 *
 * @param snapshot.files 相对路径 → 文件内容
 * @param snapshot.root 本次识别的根目录
 */
export function fingerprintFrom(snapshot) {
  const files = snapshot.files ?? {}
  const stacks = new Set()
  const repos = []

  for (const [file, stack] of Object.entries(MARKERS)) {
    if (files[file] !== undefined) stacks.add(stack)
  }

  const packageJson = files['package.json']
  if (packageJson !== undefined) {
    stacks.add('node')
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      let parsed
      try {
        parsed = JSON.parse(packageJson)
      } catch {
        break
      }
      for (const dependency of Object.keys(parsed?.[field] ?? {})) {
        const stack = DEPENDENCIES[dependency]
        if (stack !== undefined) stacks.add(stack)
      }
    }
  }

  const repo = repoOf(files['.git/config'])
  if (repo !== undefined) repos.push(repo)

  return {
    root: snapshot.root,
    stacks,
    repos,
    // fail-open 的判据：什么都没认出来，就不该藏任何条款。
    unknown: stacks.size === 0 && repos.length === 0,
  }
}

/** 把目录读成快照。只读标记文件，不遍历目录树。 */
export function readFingerprint(cwd) {
  const files = {}
  let root
  let directory = resolve(cwd)

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    for (const file of [...Object.keys(MARKERS), 'package.json', '.git/config']) {
      if (files[file] !== undefined) continue
      const target = join(directory, file)
      if (!existsSync(target)) continue
      try {
        files[file] = readFileSync(target, 'utf8')
        root ??= directory
      } catch {
        // 读不到就当它不存在：异常一律放行。
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  return fingerprintFrom({ files, root: root ?? resolve(cwd) })
}

/** 按目录缓存，避免每次收集 catalog 都读一遍文件系统。 */
export function createFingerprintCache() {
  const cache = new Map()
  return {
    of(cwd) {
      const key = resolve(cwd)
      const hit = cache.get(key)
      if (hit !== undefined) return hit
      const fingerprint = readFingerprint(key)
      cache.set(key, fingerprint)
      return fingerprint
    },
    clear() {
      cache.clear()
    },
  }
}
