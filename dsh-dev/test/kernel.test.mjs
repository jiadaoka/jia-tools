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

test('sudo / env / command 前缀不影响判定', () => {
  // 前缀不改变命令的性质。`sudo` 在个人机上很常见，漏一个就等于留了条绕道。
  assert.match(inspectCommand('sudo git commit -m x') ?? '', /commit/)
  assert.match(inspectCommand('command git push') ?? '', /push/)
  assert.match(inspectBuild('sudo npm run build') ?? '', /build/)
  assert.match(inspectBuild('CI=1 sudo npm run build') ?? '', /build/, '多层前缀要连剥到底')
  assert.equal(inspectBuild('sudo git status'), undefined)
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

test('门禁：所有落盘工具都受凭据路径约束，漏一个就等于留了后门', () => {
  for (const name of ['write', 'edit', 'str_replace_editor']) {
    assert.equal(typeof judge({ name, arguments: { file_path: '.env' } }), 'string', name)
  }
  assert.equal(typeof judge({ name: 'str_replace_editor', arguments: { path: 'secrets.yaml' } }), 'string')
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
    'turbo run build',
    'turbo build',
    'nx build app',
    'nx run web:test',
  ]) {
    assert.notEqual(inspectBuild(command), undefined, command)
  }
})

test('构建：编排器里不含构建词的目标放行', () => {
  // `nx g` 是生成器，`turbo prune` 是裁剪，都不是「跑一遍构建」。
  for (const command of ['nx g @nx/react:app web', 'turbo prune', 'nx --version']) {
    assert.equal(inspectBuild(command), undefined, command)
  }
})

test('构建：npx 之类临时执行器调的构建器也算', () => {
  for (const command of [
    'npx tsc --noEmit',
    'npx vue-tsc --noEmit',
    'npx vite build',
    'npx jest',
    'npx vitest run',
    'pnpm dlx vitest',
    'bunx vite build',
    'npm exec -- tsc',
  ]) {
    assert.notEqual(inspectBuild(command), undefined, command)
  }
  // 不是构建器的临时命令不拦：prettier 是格式化，不是构建。
  assert.equal(inspectBuild('npx prettier -w .'), undefined)
})

test('构建：包管理器的定位选项不影响判定', () => {
  for (const command of [
    'pnpm -C packages/app build',
    'pnpm -w run build',
    'pnpm --filter web test',
    'npm --prefix app run build',
    'yarn --cwd web typecheck',
  ]) {
    assert.notEqual(inspectBuild(command), undefined, command)
  }
})

test('构建：包一层 shell 不算绕过', () => {
  for (const command of [
    'bash -c "npm run build"',
    "sh -c 'pnpm test'",
    'cmd /c npm run build',
    'pwsh -NoProfile -Command "npm run build"',
    'powerShell -Command "npx tsc --noEmit"',
    'bash -c "npm run build" --flag',
  ]) {
    assert.notEqual(inspectBuild(command), undefined, command)
  }
})

test('git：包一层 shell 也不算绕过', () => {
  assert.match(inspectCommand('bash -c "git commit -m x"') ?? '', /commit/)
  assert.match(inspectCommand("sh -c 'git push'") ?? '', /push/)
})

test('不是构建的命令不被识别', () => {
  for (const command of [
    'npm install',
    'npm run dev',
    'pnpm dev',
    'vite',
    'npm run preview',
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
