import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectBuild, inspectCommand, isSensitiveTarget, judge } from '../src/kernel.js'

test('只读的 git 命令一律放行', () => {
  for (const command of [
    'git status',
    'git diff --staged',
    'git log -5 --oneline',
    'git show HEAD',
    'git branch',
    'git branch -a',
  ]) {
    assert.equal(inspectCommand(command), undefined, command)
  }
})

test('写在引号里的文字不是命令', () => {
  assert.equal(inspectCommand('echo "git commit -m x"'), undefined)
  assert.equal(inspectCommand("printf 'git push'"), undefined)
})

test('子命令在全局选项之后也能判出来', () => {
  assert.match(inspectCommand('git -C sub commit -m x') ?? '', /commit/)
  assert.match(inspectCommand('git --no-pager push') ?? '', /push/)
})

test('用 --grep 搜提交信息不算写操作', () => {
  assert.equal(inspectCommand('git log --grep=commit'), undefined)
  assert.equal(inspectCommand('git log --grep=reset'), undefined)
})

test('命令链里任何一段命中都算', () => {
  assert.match(inspectCommand('cd repo && git push') ?? '', /push/)
  assert.match(inspectCommand('npm run build; git commit -am x') ?? '', /commit/)
  assert.match(inspectCommand('npm test\ngit reset --hard HEAD~1') ?? '', /reset/)
})

test('前置环境变量赋值不影响判定', () => {
  assert.match(inspectCommand('GIT_TRACE=1 git commit -m x') ?? '', /commit/)
})

test('分支、标签、暂存区的删除单独判', () => {
  assert.match(inspectCommand('git branch -D feature/x') ?? '', /branch/)
  assert.equal(inspectCommand('git tag -l'), undefined)
  assert.match(inspectCommand('git tag -d v1.0.0') ?? '', /tag/)
})

test('敏感路径：凭据落盘位置', () => {
  for (const target of ['.env', 'config/production.pem', 'secrets.yaml', 'keys/id_rsa', 'src/credentials.json']) {
    assert.equal(isSensitiveTarget(target), true, target)
  }
})

test('敏感路径：模板与普通代码放行', () => {
  for (const target of ['.env.example', '.env.sample', 'src/app.ts', 'docs/keys.md', '']) {
    assert.equal(isSensitiveTarget(target), false, target)
  }
})

test('门禁：shell 里的写操作被拒', () => {
  const reason = judge({ name: 'win_bash', arguments: { command: 'git commit -m x' } })
  assert.equal(typeof reason, 'string')
  assert.match(reason, /版本控制写操作/)
})

test('门禁：读操作与普通工具放行', () => {
  assert.equal(judge({ name: 'win_bash', arguments: { command: 'git status' } }), undefined)
  assert.equal(judge({ name: 'read', arguments: { file_path: '.env' } }), undefined)
  assert.equal(judge({ name: 'edit', arguments: { file_path: 'src/app.ts' } }), undefined)
})

test('门禁：写凭据被拒，写模板放行', () => {
  assert.equal(typeof judge({ name: 'write', arguments: { file_path: '.env' } }), 'string')
  assert.equal(judge({ name: 'write', arguments: { file_path: '.env.example' } }), undefined)
})

test('门禁：总开关关闭后全部放行', () => {
  const env = { DSH_DEV_GUARD: 'off' }
  assert.equal(judge({ name: 'write', arguments: { file_path: '.env' } }, env), undefined)
  assert.equal(judge({ name: 'win_bash', arguments: { command: 'git push' } }, env), undefined)
})

test('门禁对坏输入不抛错', () => {
  assert.equal(judge({ name: 'win_bash', arguments: null }), undefined)
  assert.equal(judge({ name: 'write', arguments: 'nope' }), undefined)
  assert.equal(judge({ name: 'write', arguments: {} }), undefined)
})

test('构建与测试命令被识别', () => {
  for (const command of [
    'npm run build',
    'npm run build:prod',
    'pnpm test',
    'yarn build',
    'bun run typecheck',
    'npm run lint',
    'vite build',
    'tsc --noEmit',
    'vue-tsc --noEmit',
    'go build ./...',
    'go test ./...',
    'cargo build --release',
    'cargo test',
    'mvn package',
    './gradlew build',
    'make',
    'pytest -q',
    'jest',
    'node --test',
  ]) {
    assert.notEqual(inspectBuild(command), undefined, command)
  }
})

test('不是构建的命令不被识别', () => {
  for (const command of [
    'npm install',
    'npm run dev',
    'pnpm dev',
    'vite',
    'node script.js',
    'node -e "console.log(1)"',
    'git status',
    'ls dist',
    'echo "npm run build"',
    'cat package.json',
  ]) {
    assert.equal(inspectBuild(command), undefined, command)
  }
})

test('命令链里夹着构建也算', () => {
  assert.notEqual(inspectBuild('cd app && npm run build'), undefined)
  assert.notEqual(inspectBuild('npm ci; npm test'), undefined)
  assert.notEqual(inspectBuild('npm ci\nnpm run build'), undefined)
})

test('门禁：构建类命令被拒', () => {
  const reason = judge({ name: 'win_bash', arguments: { command: 'npm run build' } })
  assert.equal(typeof reason, 'string')
  assert.match(reason, /构建、打包、测试/)
})

test('门禁：版本控制写操作的理由与构建分开', () => {
  const reason = judge({ name: 'win_bash', arguments: { command: 'git commit -m x' } })
  assert.match(reason, /版本控制写操作/)
})
