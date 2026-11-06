import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { apply } from '../index.js'

/** 用一个桩 ctx 挂载插件，拿到它注册的三样东西。 */
function mount() {
  const captured = { sections: [], guards: [], provider: undefined }
  apply({
    skills: {
      registerProvider(factory) {
        captured.factory = factory
      },
    },
    get(service) {
      if (service === 'systemPrompt') {
        return {
          section(section) {
            captured.sections.push(section)
            return () => {}
          },
        }
      }
      if (service === 'tools') {
        return {
          guard(guard) {
            captured.guards.push(guard)
            return () => {}
          },
        }
      }
      return undefined
    },
  })

  const controller = new AbortController()
  captured.provider = captured.factory({ signal: controller.signal, invalidate() {} })
  captured.dispose = () => controller.abort()
  return captured
}

function fixture(files) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dev-'))
  for (const [name, content] of Object.entries(files)) {
    const target = join(directory, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return directory
}

test('挂载时三样都注册了', () => {
  const mounted = mount()
  try {
    assert.equal(typeof mounted.provider.list, 'function')
    assert.equal(mounted.sections.length, 1)
    assert.equal(mounted.sections[0].name, 'dev:discipline')
    assert.match(mounted.sections[0].text, /工程纪律/)
    assert.equal(mounted.guards.length, 1)
  } finally {
    mounted.dispose()
  }
})

test('vue 项目看得到 vue 条款，python 项目看不到', async () => {
  const vue = fixture({ 'package.json': JSON.stringify({ dependencies: { vue: '^3' } }) })
  const python = fixture({ 'pyproject.toml': '[project]\nname = "x"\n' })
  const mounted = mount()
  try {
    const names = async (cwd) => (await mounted.provider.list({ cwd })).map((entry) => entry.name)

    const inVue = await names(vue)
    const inPython = await names(python)

    assert.ok(inVue.includes('dev-vue-sfc-order'), 'vue 项目里应当看得到 vue 条款')
    assert.ok(!inPython.includes('dev-vue-sfc-order'), 'python 项目里不该出现 vue 条款')
    assert.ok(inPython.includes('dev-git-commit'), '通用条款在任何项目里都该在')
    assert.deepEqual(
      inVue.filter((name) => !inPython.includes(name)),
      ['dev-vue-container-split', 'dev-vue-sfc-order'],
    )
  } finally {
    mounted.dispose()
    rmSync(vue, { recursive: true, force: true })
    rmSync(python, { recursive: true, force: true })
  }
})

test('空目录认不出身份时全部可见（fail-open）', async () => {
  const empty = fixture({ 'readme.txt': 'nothing to identify' })
  const mounted = mount()
  try {
    const names = (await mounted.provider.list({ cwd: empty })).map((entry) => entry.name)
    assert.ok(names.includes('dev-vue-sfc-order'), '认不出身份时不应该藏条款')
    assert.ok(names.includes('dev-git-commit'))
  } finally {
    mounted.dispose()
    rmSync(empty, { recursive: true, force: true })
  }
})

test('candidate 带资源基准，加载回来的正文与文件一致', async () => {
  const mounted = mount()
  try {
    const candidates = await mounted.provider.list({ cwd: process.cwd() })
    const candidate = candidates.find((entry) => entry.name === 'dev-git-commit')
    assert.ok(candidate !== undefined)
    assert.equal(candidate.resourceBase.kind, 'directory')
    assert.equal(candidate.source, 'dev')

    const definition = await mounted.provider.get({ name: 'dev-git-commit' })
    assert.equal(definition.name, 'dev-git-commit')
    assert.match(definition.content, /commit/)
    assert.ok(definition.content.length > 500, '正文应当完整')
  } finally {
    mounted.dispose()
  }
})

test('请求不存在的条款返回 undefined 而不是抛错', async () => {
  const mounted = mount()
  try {
    assert.equal(await mounted.provider.get({ name: 'dev-does-not-exist' }), undefined)
  } finally {
    mounted.dispose()
  }
})
