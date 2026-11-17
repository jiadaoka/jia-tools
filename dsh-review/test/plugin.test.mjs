/**
 * 装配断言：用桩 ctx 挂载，确认这个包在宿主里会暴露什么。
 *
 * 这里刻意不 import 任何 `@deepseek-ai/*`：本包用 `link:` 装进 profile 时，
 * 插件模块的 realpath 在 jia-tools 下，宿主那套包解析不到，`defineTool` 一引入
 * 就是挂载期 `failed to import`。工具定义必须是自足的 JSON Schema。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, missingOcrMessage, name, normalizeConfig, readResident, unitName } from '../index.js'

function mount(config = {}) {
  const captured = { sections: [], tools: [], factory: undefined }
  const controller = new AbortController()
  const control = { invalidate() {}, signal: controller.signal }

  const ctx = {
    skills: {
      registerProvider(factory) {
        captured.factory = factory
        factory(control)
      },
    },
    tools: {
      register(definition) {
        captured.tools.push(definition)
        return () => {}
      },
    },
    get(service) {
      if (service === 'systemPrompt') return { section: (section) => captured.sections.push(section) }
      if (service === 'tools') return ctx.tools
      return undefined
    },
    logger: { warn() {} },
  }

  apply(ctx, config)
  captured.dispose = () => controller.abort()
  return captured
}

test('暴露两个工具，名字与约定一致', () => {
  const captured = mount()
  assert.deepEqual(
    captured.tools.map((tool) => tool.name),
    ['review_scope', 'review_rules'],
  )
})

test('工具定义是自足的：JSON Schema + render，不依赖 SDK 包装', () => {
  for (const tool of mount().tools) {
    assert.equal(typeof tool.description, 'string', `${tool.name}: 没有描述`)
    assert.equal(tool.parameters.type, 'object', `${tool.name}: 参数必须是对象根`)
    assert.ok(tool.parameters.properties !== undefined, `${tool.name}: 没有 properties`)
    assert.equal(typeof tool.output.render, 'function', `${tool.name}: 没有 render`)
    assert.equal(tool.output.schema.type, 'object', `${tool.name}: 输出 schema 不是对象根`)
    assert.deepEqual(tool.output.schema.required, ['headline', 'output'])
    assert.equal(typeof tool.execute, 'function')
  }
})

test('review_rules 要求至少一个路径', () => {
  const rules = mount().tools.find((tool) => tool.name === 'review_rules')
  assert.deepEqual(rules.parameters.required, ['paths'])
  assert.equal(rules.parameters.properties.paths.type, 'array')
})

test('常驻提示挂了一段，内容是那四条', () => {
  const captured = mount()
  assert.equal(captured.sections.length, 1)
  assert.equal(captured.sections[0].name, 'review:discipline')
  assert.match(captured.sections[0].text, /审查只读/)
  assert.equal(captured.sections[0].text, readResident())
})

test('技能 provider 列出六条，get 拿得到正文', async () => {
  const captured = mount()
  const provider = captured.factory({ invalidate() {}, signal: { addEventListener() {} } })
  const list = await provider.list()
  assert.deepEqual(
    list.map((entry) => entry.name),
    [
      'review-dependency',
      'review-evidence',
      'review-recheck',
      'review-report',
      'review-scope',
      'review-self',
    ],
  )
  assert.ok(list.every((entry) => entry.provider === 'review'))
  assert.ok(list.every((entry) => entry.description.length > 20))

  const definition = await provider.get(list[0])
  assert.match(definition.content, /^#\s+\S/m, '技能正文应当是干净的 Markdown')
  assert.ok(!definition.content.startsWith('---'), 'frontmatter 不该混进正文')
})

test('provider 对不认识的 candidate 返回 undefined，而不是抛错', async () => {
  const provider = mount().factory({ invalidate() {}, signal: { addEventListener() {} } })
  assert.equal(await provider.get({ name: 'not-a-review-skill' }), undefined)
})

test('配置归一化：默认值、环境变量、坏值', () => {
  assert.deepEqual(normalizeConfig({}, {}), { ocrPath: '', timeoutMs: 180000 })
  assert.equal(normalizeConfig({ ocrPath: 'D:/x.exe' }, {}).ocrPath, 'D:/x.exe')
  assert.equal(normalizeConfig({}, { DSH_REVIEW_OCR: 'E:/y.exe' }).ocrPath, 'E:/y.exe')
  assert.equal(normalizeConfig({}, { DSH_REVIEW_TIMEOUT_MS: '5000' }).timeoutMs, 5000)
  assert.equal(normalizeConfig({ timeoutMs: 'abc' }, {}).timeoutMs, 180000, '坏值退回默认')
  assert.equal(normalizeConfig({ timeoutMs: -1 }, {}).timeoutMs, 180000)
})

test('单元名带仓库名与时间戳', () => {
  const stamp = unitName('E:/project/engineering/jia-tools', new Date(2026, 10, 9, 17, 5))
  assert.equal(stamp, 'LOCAL-jia-tools-202611091705')
})

test('找不到 ocr 时说清三件事：找过哪里、装什么、装完怎么办', () => {
  const message = missingOcrMessage(['C:/a/ocr.exe', 'C:/b/ocr/opencodereview.exe'])
  assert.match(message, /找过/)
  assert.match(message, /C:\/a\/ocr\.exe/)
  assert.match(message, /npm install/)
  assert.match(message, /不需要重启/)
  assert.match(message, /ocrPath/)
})

test('插件名与 bundle id 对齐', () => {
  assert.equal(name, 'dsh-review')
})
