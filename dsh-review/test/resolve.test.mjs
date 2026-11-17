import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  BINARY_NAME,
  candidatesIn,
  parseVersion,
  platformPackageName,
  resolveOcr,
  supportsJson,
} from '../src/resolve.js'

const PLATFORM = 'win32'
const ARCH = 'x64'
const PKG = platformPackageName(PLATFORM, ARCH)

/** 只认给定路径集合的 exists，避免测试碰到真实磁盘。 */
const only = (...paths) => (file) => paths.includes(file)

const globalRoot = join('C:', 'Users', 'u', 'AppData', 'Roaming', 'npm', 'node_modules')

test('显式配置优先，且可指文件', () => {
  const exe = join('D:', 'tools', BINARY_NAME)
  const result = resolveOcr({
    ocrPath: exe,
    env: {},
    isFile: only(exe),
    platform: PLATFORM,
    arch: ARCH,
    homedir: 'C:/Users/u',
  })
  assert.equal(result.command, exe)
  assert.equal(result.source, 'config.ocrPath')
})

test('显式配置可指安装目录，向下找到平台包里的二进制', () => {
  const dir = join('D:', 'tools', 'ocr')
  const exe = join(dir, 'node_modules', '@alibaba-group', PKG, 'bin', BINARY_NAME)
  const result = resolveOcr({
    ocrPath: dir,
    env: {},
    isFile: only(exe),
    platform: PLATFORM,
    arch: ARCH,
    homedir: 'C:/Users/u',
  })
  assert.equal(result.command, exe)
  assert.equal(result.source, 'config.ocrPath')
})

test('环境变量优先于已知目录', () => {
  const fromEnv = join('E:', 'bin', BINARY_NAME)
  const inHome = join('C:', 'Users', 'u', '.dsh', 'open-code-review', 'node_modules', '@alibaba-group', PKG, 'bin', BINARY_NAME)
  const result = resolveOcr({
    env: { DSH_REVIEW_OCR: fromEnv, DSH_HOME: join('C:', 'Users', 'u', '.dsh') },
    isFile: only(fromEnv, inHome),
    platform: PLATFORM,
    arch: ARCH,
    homedir: 'C:/Users/u',
  })
  assert.equal(result.command, fromEnv)
  assert.equal(result.source, 'env.DSH_REVIEW_OCR')
})

test('没配置时复用 dsh-open-code-review 装好的那份', () => {
  const dshHome = join('C:', 'Users', 'u', '.dsh')
  const exe = join(dshHome, 'open-code-review', 'node_modules', '@alibaba-group', PKG, 'bin', BINARY_NAME)
  const result = resolveOcr({
    env: { DSH_HOME: dshHome },
    isFile: only(exe),
    platform: PLATFORM,
    arch: ARCH,
    homedir: 'C:/Users/u',
  })
  assert.equal(result.command, exe)
  assert.equal(result.source, 'dshHome/open-code-review')
})

test('全局 npm 装的也能找到', () => {
  const exe = join(globalRoot, '@alibaba-group', 'open-code-review', 'node_modules', '@alibaba-group', PKG, 'bin', BINARY_NAME)
  const result = resolveOcr({
    env: { APPDATA: join('C:', 'Users', 'u', 'AppData', 'Roaming') },
    isFile: only(exe),
    platform: PLATFORM,
    arch: ARCH,
    homedir: 'C:/Users/u',
  })
  assert.equal(result.command, exe)
  assert.equal(result.source, 'npm global')
})

test('PATH 里的原生可执行文件是最后一道', () => {
  const dir = join('C:', 'tools', 'bin')
  const exe = join(dir, BINARY_NAME)
  const result = resolveOcr({
    env: { PATH: dir },
    isFile: only(exe),
    platform: PLATFORM,
    arch: ARCH,
    homedir: 'C:/Users/u',
  })
  assert.equal(result.command, exe)
  assert.equal(result.source, 'PATH')
})

test('一个都没有时返回找过的清单，而不是抛错', () => {
  const result = resolveOcr({
    env: { DSH_HOME: join('C:', 'Users', 'u', '.dsh'), PATH: join('C:', 'tools', 'bin') },
    isFile: () => false,
    platform: PLATFORM,
    arch: ARCH,
    homedir: 'C:/Users/u',
  })
  assert.ok(Array.isArray(result.missing), '应当返回 missing 清单')
  assert.ok(result.missing.length >= 3, `尝试的路径太少：${result.missing.length}`)
  assert.ok(result.missing.some((path) => path.includes('.dsh')), '应当尝试过 DSH_HOME')
})

test('空字符串的配置项不算路径', () => {
  const exe = join('C:', 'tools', 'bin', BINARY_NAME)
  const result = resolveOcr({
    ocrPath: '   ',
    env: { PATH: join('C:', 'tools', 'bin') },
    isFile: only(exe),
    platform: PLATFORM,
    arch: ARCH,
    homedir: 'C:/Users/u',
  })
  assert.equal(result.source, 'PATH')
})

test('目录不会被当成可执行文件返回', () => {
  // 真机上 `~/.dsh/open-code-review` 就是这种：目录存在，但直接 spawn 会 ENOENT。
  // 这里用真实文件系统，验证默认判定走的是「是不是文件」而不是「存不存在」。
  const dir = mkdtempSync(join(tmpdir(), 'dsh-review-resolve-'))
  try {
    const result = resolveOcr({
      ocrPath: dir,
      env: {},
      platform: PLATFORM,
      arch: ARCH,
      homedir: join(dir, 'nobody'),
    })
    assert.equal(result.command, undefined, '不能把目录当命令')
    assert.ok(Array.isArray(result.missing))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('candidatesIn 覆盖直放、bin 与平台包三种布局', () => {
  const dir = join('D:', 'ocr')
  const list = candidatesIn(dir, PLATFORM, ARCH)
  assert.ok(list.includes(join(dir, BINARY_NAME)))
  assert.ok(list.includes(join(dir, 'bin', BINARY_NAME)))
  assert.ok(list.includes(join(dir, 'node_modules', '@alibaba-group', PKG, 'bin', BINARY_NAME)))
})

test('版本解析与地板判定', () => {
  assert.deepEqual(parseVersion('open-code-review v1.13.3 (375f64c) windows/amd64'), [1, 13, 3])
  assert.deepEqual(parseVersion('1.9.0'), [1, 9, 0])
  assert.equal(parseVersion('no version here'), undefined)
  assert.equal(supportsJson([1, 8, 9]), false)
  assert.equal(supportsJson([1, 9, 0]), true)
  assert.equal(supportsJson([2, 0, 0]), true)
  assert.equal(supportsJson(undefined), false)
})
