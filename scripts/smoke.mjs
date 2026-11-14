/**
 * Smoke test for the built artifacts, without a browser or a running host:
 * 1. the host half registers one system-prompt section and renders the config,
 * 2. the client half registers the settings page and its save path.
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

// --- host half -------------------------------------------------------------

const host = await import(new URL('../lib/index.js', import.meta.url).href)
const reads = { userName: '老张', assistantName: '小深', persona: '先给结论。', enabled: true, injectDiaries: true, retainDays: 0 }
const diaryRoot = join(tmpdir(), `dsh-plastic-memories-smoke-${process.pid}`)
rmSync(diaryRoot, { recursive: true, force: true })
const config = {
  userName: { get: () => reads.userName },
  assistantName: { get: () => reads.assistantName },
  persona: { get: () => reads.persona },
  enabled: { get: () => reads.enabled },
  injectDiaries: { get: () => reads.injectDiaries },
  retainDays: { get: () => reads.retainDays },
  diaryRoot,
}
let registered
const sections = new Map()
const tools = new Map()
const routes = []
const disposers = []
const handlers = new Map()
const hostCtx = {
  fiber: {},
  on: (event, listener) => { handlers.set(event, listener); return () => {} },
  effect: (fn, label) => { const dispose = fn(); disposers.push(dispose); return dispose },
  inject: (deps, callback) => callback(hostCtx),
  settings: { configure: () => {} },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  systemPrompt: {
    section: (definition) => { sections.set(definition.name, definition); return () => {} },
    getSectionOrder: () => 0,
  },
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
}
assert.equal(host.name, 'plastic-memories')
assert.deepEqual(host.inject, ['systemPrompt', 'tools'])
host.apply(hostCtx, config)
registered = sections.get('plastic-memories:persona')
assert.equal(registered.name, 'plastic-memories:persona')
assert.equal(registered.order, 1)
assert.equal(registered.interpolate, false)
assert.equal(typeof registered.text, 'function')
assert.equal(registered.text(), 'Address the user as "老张".\nYour name is "小深"; the user calls you by it.\n先给结论。')

// Blank fields collapse to an empty section instead of a stray template.
reads.userName = ''
reads.assistantName = ''
reads.persona = ''
assert.equal(registered.text(), '')
// Live reads: the section function re-reads the volatile references each time.
reads.assistantName = '小深'
assert.equal(registered.text(), 'Your name is "小深"; the user calls you by it.')

// `{{user}}` / `{{char}}` expand from the two names, with generic fallbacks.
reads.userName = '老张'
reads.persona = '你是{{char}}，称呼{{user}}。'
assert.equal(registered.text(), 'Address the user as "老张".\nYour name is "小深"; the user calls you by it.\n你是小深，称呼老张。')
reads.userName = ''
reads.assistantName = ''
assert.equal(registered.text(), '你是the assistant，称呼the user。')

// The enable switch suppresses the whole section.
reads.enabled = false
assert.equal(registered.text(), '')
reads.enabled = true
reads.persona = ''

// The diary paragraph follows the persona and disappears with the same switch.
const diarySection = sections.get('plastic-memories:diary')
assert.equal(diarySection.name, 'plastic-memories:diary')
assert.equal(diarySection.order, 2)
assert.equal(diarySection.interpolate, false)
assert.match(diarySection.text(), /^Diary habit: you keep this diary yourself/)
assert.ok(diarySection.text().length < 450, 'diary guidance stays short')
reads.enabled = false
assert.equal(diarySection.text(), '')
reads.enabled = true

// --- diary tools -----------------------------------------------------------

const run = (tool, args) => tool.execute(args, { signal: new AbortController().signal })
const textOf = (tool, value, args = {}) => tool.output.render(args, value)[0].text
const noteTool = tools.get('diary_note')
const readTool = tools.get('diary_read')
assert.ok(noteTool && readTool, 'both diary tools are registered')
assert.equal(tools.size, 2, 'no third tool for listing')

const today = new Date()
const tag = `${today.getMonth() + 1}月${today.getDate()}日`
const titlesText = async () => textOf(readTool, await run(readTool, {}))

assert.equal(await titlesText(), 'No diaries yet.')

// The first note of the day creates the file and owns its name.
const first = await run(noteTool, { note: '主人今天感觉好开心，他说中奖了', summary: '用户说中奖了' })
assert.equal(first.file, `${tag}-用户说中奖了.md`)
assert.equal(first.created, true)
assert.match(first.line, /^\d{1,2}\.\d{2}\.\d{2}: 主人今天感觉好开心，他说中奖了$/)
assert.match(readFileSync(join(diaryRoot, first.file), 'utf8'), /\n$/)
assert.equal(textOf(noteTool, first), 'success')

// Later notes append one line and keep the name.
const second = await run(noteTool, { note: '电脑又新增了日记工具' })
assert.equal(second.file, first.file)
assert.equal(second.created, false)
assert.equal(await titlesText(), `${tag}-用户说中奖了 (2 lines)`)

// A new summary renames today's file without touching its content.
const third = await run(noteTool, { note: '主人说这个项目很重要', summary: '主人说项目重要' })
assert.equal(third.file, `${tag}-主人说项目重要.md`)
assert.throws(() => readFileSync(join(diaryRoot, first.file), 'utf8'))
assert.equal(readFileSync(join(diaryRoot, third.file), 'utf8').trim().split('\n').length, 3)
assert.equal(await titlesText(), `${tag}-主人说项目重要 (3 lines)`)

// Reading works by full name, with .md, and by the date fragment.
const full = await run(readTool, { name: third.file.replace(/\.md$/, '') })
assert.equal(full.name, third.file.replace(/\.md$/, ''))
assert.match(full.content, /电脑又新增了日记工具/)
assert.equal((await run(readTool, { name: third.file })).name, full.name)
assert.equal((await run(readTool, { name: tag })).name, full.name)
await assert.rejects(() => run(readTool, { name: '不存在' }), /No diary matches/)

// One line per call, and a fresh day needs a summary to name the file.
await assert.rejects(() => run(noteTool, { note: '第一行\n第二行' }), /one line per call/)
rmSync(join(diaryRoot, third.file))
await assert.rejects(() => run(noteTool, { note: '没有名字的日记' }), /Pass a short summary/)

// Other diaries are never modified, and a fragment matching two diaries is ambiguous.
const oldFile = join(diaryRoot, '11月01日-旧日记.md')
mkdirSync(diaryRoot, { recursive: true })
writeFileSync(oldFile, '9.00.00: 旧内容\n', 'utf8')
await run(noteTool, { note: '主人说这个文件不要乱动', summary: '主人说别乱动文件' })
assert.equal(readFileSync(oldFile, 'utf8'), '9.00.00: 旧内容\n')
assert.equal((await run(readTool, {})).diaries.length, 2)
await assert.rejects(() => run(readTool, { name: '11月' }), /matches several diaries/)

// Retention deletes files outside the window and leaves recent ones alone;
// 0 means "keep everything", which is the default.
writeFileSync(join(diaryRoot, '1月05日-很久以前.md'), '9.00.00: 旧的一行\n', 'utf8')
reads.retainDays = 30
await run(noteTool, { note: '又记一笔' })
const afterPrune = (await run(readTool, {})).diaries.map((entry) => entry.name)
assert.ok(!afterPrune.includes('1月05日-很久以前'), 'expired diary should be pruned')
assert.ok(afterPrune.includes('11月01日-旧日记'), 'recent diary should stay')
reads.retainDays = 0
writeFileSync(join(diaryRoot, '1月06日-也很久以前.md'), '9.00.00: 旧的一行\n', 'utf8')
await run(noteTool, { note: '再记一笔' })
const kept = (await run(readTool, {})).diaries.map((entry) => entry.name)
assert.ok(kept.includes('1月06日-也很久以前'), 'retention 0 keeps every diary')
rmSync(join(diaryRoot, '1月06日-也很久以前.md'), { force: true })

// A new session receives one index of the existing diaries; the message is
// attributed to the plugin, and resumed sessions keep what they already have.
const injectedMessages = []
const fakeAgent = { inject: (message) => { injectedMessages.push(message) } }
const onCreated = handlers.get('agent/created')
assert.equal(typeof onCreated, 'function')
await onCreated({ agent: fakeAgent, source: 'startup' })
assert.equal(injectedMessages.length, 1)
assert.equal(injectedMessages[0].role, 'user')
assert.equal(injectedMessages[0].source.kind, 'plugin:plastic-memories')
const indexText = injectedMessages[0].content[0].text
assert.match(indexText, /^Your diaries, newest first:\n/)
assert.match(indexText, /\(1 line\)/)
assert.match(indexText, /Call diary_read with a name to read one\.$/)

// Resume and compaction already carry their index; the switch turns it off.
await onCreated({ agent: fakeAgent, source: 'resume' })
await onCreated({ agent: fakeAgent, source: 'compact' })
assert.equal(injectedMessages.length, 1)
reads.injectDiaries = false
await onCreated({ agent: fakeAgent, source: 'startup' })
assert.equal(injectedMessages.length, 1)
reads.injectDiaries = true
await onCreated({ agent: fakeAgent, source: 'clear' })
assert.equal(injectedMessages.length, 2)

// The index folds older titles so a long history cannot flood a request.
assert.equal(host.renderDiaryIndex([]), '')
const many = Array.from({ length: 45 }, (_, index) => ({ name: `1月${index + 1}日-记${index}`, lines: 1 }))
assert.match(host.renderDiaryIndex(many), /…and 5 older ones\./)
assert.match(host.renderDiaryIndex([{ name: '11月01日-旧日记', lines: 3 }]), /\(3 lines\)/)

// A long diary is cut to its newest 200 lines so one file cannot flood a request.
writeFileSync(
  join(diaryRoot, '11月02日-长日记.md'),
  Array.from({ length: 250 }, (_, index) => `${index}. 第${index}行`).join('\n') + '\n',
  'utf8',
)
const long = await run(readTool, { name: '11月02日' })
assert.match(long.content, /^…\(50 earlier lines omitted\)/)
assert.equal(long.content.trimEnd().split('\n').length, 201)

// --- diary preview route ---------------------------------------------------

// The Settings preview reads through this exact route; it must never invent a
// path, so a name outside the list is answered 404 rather than read.
const route = routes.find((candidate) => candidate.path === '/plastic-memories/diary')
assert.ok(route, 'the preview route is registered')
assert.equal(route.kind, 'exact')
const list = await (await route.resource(new Request('http://local/plastic-memories/diary'))).json()
assert.deepEqual(
  list.diaries.map((diary) => diary.name),
  [`${tag}-主人说别乱动文件`, '11月02日-长日记', '11月01日-旧日记'],
)
assert.ok(list.diaries.every((diary) => typeof diary.lines === 'number' && diary.lines > 0))

const selected = await (await route.resource(
  new Request(`http://local/plastic-memories/diary?name=${encodeURIComponent(tag)}`),
)).json()
assert.equal(selected.selected.name, `${tag}-主人说别乱动文件`)
assert.match(selected.selected.content, /不要乱动/)

assert.equal((await route.resource(new Request('http://local/plastic-memories/diary?name=不存在'))).status, 404)

// --- client half -----------------------------------------------------------

globalThis.window = {}
const clientSource = readFileSync(join(root, 'lib/client.js'), 'utf8')
let loaded
globalThis.window.__ModuleLoader__ = { load: (definition) => { loaded = definition } }
new Function('require', 'window', clientSource)(require, globalThis.window)
assert.equal(loaded.id, 'dsh-plastic-memories')

const client = loaded.factory(require)
assert.equal(client.name, 'plastic-memories')
assert.deepEqual(client.inject, ['slots', 'locale', 'configForms'])

const dictionaries = {}
const calls = []
const formState = { status: 'ready', value: { userName: '老张', assistantName: '', persona: '', enabled: true, injectDiaries: true, retainDays: 0 }, writable: true }
const writes = []
const form = {
  getSnapshot: () => formState,
  subscribe: (listener) => { writes.push(['subscribe']); return () => {} },
  set: async (field, value) => { writes.push([field, value]); return true },
}
let declaration
let sectionRegistered
const clientCtx = {
  effect: (fn) => fn(),
  locale: {
    register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {} },
    bind: (ns) => (key) => dictionaries[ns].zh[key],
  },
  slots: {
    inject: (name, callback) => { calls.push(['inject', name]); return callback() },
    register: (decl, component) => { declaration = decl; sectionRegistered = component; return () => {} },
  },
  configForms: { get: (id) => { calls.push(['form', id]); return form } },
}
client.apply(clientCtx)
assert.deepEqual(calls, [['inject', 'settings.section'], ['form', 'plastic-memories']])
assert.equal(declaration.name, 'settings.section')
assert.equal(declaration.id, 'plastic-memories')
assert.equal(declaration.order, 40)
assert.equal(declaration.label(), '个性化人设')
assert.equal(typeof sectionRegistered, 'function')

const injected = declaration.inject()
// Copy is locale-owned and editable by the operator; only presence is asserted.
for (const key of ['userName', 'assistantName', 'persona', 'enabled', 'injectDiaries', 'retainDays']) {
  assert.ok(injected.t(key).length > 0, `missing copy for ${key}`)
}
assert.deepEqual(injected.read(), formState.value)
assert.equal(injected.writable(), true)
injected.subscribe(() => {})
await injected.save({ userName: '老张', assistantName: '小深', persona: '', enabled: true, injectDiaries: false, retainDays: 30 })
assert.deepEqual(writes.slice(1), [
  ['userName', '老张'],
  ['assistantName', '小深'],
  ['persona', ''],
  ['enabled', true],
  ['injectDiaries', false],
  ['retainDays', 30],
])

// Character cards round-trip, and V1/V2 text maps onto the three fields.
const exported = JSON.parse(client.toCardJson({ userName: 'Azusa', assistantName: 'neko', persona: '猫娘' }))
assert.equal(exported.spec, 'chara_card_v2')
assert.equal(exported.data.name, 'neko')
assert.equal(exported.data.description, '猫娘')
assert.deepEqual(client.fromCardText(JSON.stringify(exported)), {
  userName: 'Azusa', assistantName: 'neko', persona: '猫娘',
})
assert.deepEqual(client.fromCardText(JSON.stringify({ name: '小深', description: '猫娘', personality: '说话带喵' })), {
  assistantName: '小深', persona: '猫娘\n\n说话带喵',
})
assert.throws(() => client.fromCardText('not json'))
assert.throws(() => client.fromCardText('{}'))

// Loading state yields no values, and a refused write reports failure.
formState.status = 'loading'
assert.equal(injected.read(), undefined)
formState.status = 'ready'
form.set = async (field) => field !== 'assistantName'
assert.equal(await injected.save({ userName: 'a', assistantName: 'b', persona: 'c', enabled: true, injectDiaries: true, retainDays: 0 }), false)

// --- real Cordis lifecycle -------------------------------------------------

// Loads the host plugin as the harness does: service injection gates `apply`,
// and the section registration is owned by a Cordis effect (so unload releases it).
const { Context } = await import('@deepseek-ai/cordis')
const liveCtx = new Context()
const liveSections = new Map()
liveCtx.provide('systemPrompt', {
  section: (definition) => {
    liveSections.set(definition.name, definition)
    return () => { liveSections.delete(definition.name) }
  },
  getSectionOrder: () => 0,
})
liveCtx.provide('settings', { configure: () => {} })
liveCtx.provide('tools', { register: () => () => {} })
liveCtx.provide('webServer', { register: () => () => {} })
// Plain strings go through the real Config schema, so the test also covers the
// volatile references the runtime builds for each field.
const fiber = liveCtx.plugin(host, {
  userName: '老张', assistantName: '小深', persona: '先给结论。', diaryRoot: join(tmpdir(), 'dsh-plastic-memories-lifecycle'),
})
await fiber
const liveSection = liveSections.get('plastic-memories:persona')
assert.equal(typeof liveSection?.text, 'function')
assert.equal(liveSection.text(), 'Address the user as "老张".\nYour name is "小深"; the user calls you by it.\n先给结论。')
assert.equal(liveSections.size, 2, 'persona and diary sections are registered')
await fiber.dispose()
assert.equal(liveSections.size, 0, 'unload releases both sections')

console.log('smoke: host section and client page behave as expected')
