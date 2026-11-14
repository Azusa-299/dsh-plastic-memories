import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect import: merges `agent/created` and `Agent` into Context.
import type {} from '@deepseek-ai/dsh-agent'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only side-effect imports: they merge `systemPrompt` and `settings` into
// Context for type checking and are erased at build time.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { Config } from './config.ts'
import { listDiaries, renderDiaryIndex } from './diary.ts'
import { renderPersona } from './persona.ts'
import { registerDiaryRoute } from './server.ts'
import { registerDiaryTools } from './tools.ts'

// Plugin-owned message source: the session log attributes the injected index
// to this plugin instead of pretending it was the user's own message.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:plastic-memories': { readonly kind: 'plugin:plastic-memories' }
  }
}

/** Must equal the Cordis row id and the Settings namespace. */
export const name = 'plastic-memories'

/** `settings` stays optional: without it the persona is still injected. */
export const inject = ['systemPrompt', 'tools']

export { Config }

// Exported for the smoke test; the runtime only uses it inside `apply`.
export { renderDiaryIndex } from './diary.ts'

/**
 * Section name owned by this plugin.
 * `deployment:persona-*` belongs to dsh-system-prompt, which registers those
 * names unconditionally; registering them again fails the plugin load.
 */
const PERSONA_SECTION = 'plastic-memories:persona'

/** Section name for the diary instructions; sits right after the persona. */
const DIARY_SECTION = 'plastic-memories:diary'

/**
 * The diary habit, stated as a duty rather than an option: without a
 * "write it yourself, without being asked" trigger the model reads the tool as
 * available-but-optional and never calls it. The trigger list and the
 * "when in doubt" bias follow Cline's Memory Bank instructions, which ask for
 * a record at every event worth keeping instead of at the end of a session.
 */
const DIARY_GUIDANCE = 'Diary habit: you keep this diary yourself, unasked and without announcing it. '
  + 'Call diary_note whenever the user shares a fact, preference, feeling, plan, or event, '
  + 'or a conversation pauses; when in doubt, write it. '
  + 'One short line, in the user\'s language. Skip chatter and your own tool calls. '
  + 'A day\'s first note takes a summary naming the day. '
  + 'Before answering about the past, or when you want to recall what the user said, call diary_read.'

/**
 * Registers the persona text in the system prompt and claims ownership of the
 * plugin's Settings page.
 * @param ctx Host plugin context.
 * @param config Validated live persona settings.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    // Right behind the official persona prefix; ties break by name, so +1 keeps
    // this section from colliding with the persona ordering.
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1,
    // Persona text is user prose: `{{name}}` must stay literal instead of
    // failing strict interpolation for the whole request.
    interpolate: false,
    // A function, not a string: every assembly re-reads the volatile config,
    // so a saved name applies from the next request without a reload.
    text: () => renderPersona(
      config.userName.get(),
      config.assistantName.get(),
      config.persona.get(),
      config.enabled.get(),
    ),
  }), 'plastic-memories: persona section')

  ctx.effect(() => ctx.systemPrompt.section({
    name: DIARY_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 2,
    interpolate: false,
    // Disabled means "this plugin stays quiet": no persona, no diary nagging.
    text: () => (config.enabled.get() ? DIARY_GUIDANCE : ''),
  }), 'plastic-memories: diary section')

  // The plugin ships its own page; without this the Settings service would
  // generate a second form for the same three fields.
  ctx.inject(['settings'], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      'plastic-memories: settings page ownership',
    )
  })

  // The diary lives outside the Session: plain Markdown files, readable in any
  // editor, with `diaryRoot` as the deployment-varying location.
  const root = config.diaryRoot.trim() === ''
    ? dshHomePath('plastic-memories', 'diary')
    : config.diaryRoot.trim()
  registerDiaryTools(ctx, root, () => new Date(), () => config.retainDays.get())
  // The Settings preview reads through the host's web server, so the page never
  // needs filesystem access and the diary text is not exposed to the model.
  registerDiaryRoute(ctx, root)

  // A fresh session gets one user-role index of the existing diaries, so the
  // model knows what it can read back without a listing call first. Awaiting
  // the read keeps the injection inside creation: the loop holds queued input
  // until `agent/created` listeners settle.
  ctx.on('agent/created', async ({ agent, source }) => {
    // A resumed or compacted session already carries the index it was created
    // with; only a new conversation needs one.
    if (source !== 'startup' && source !== 'clear') return
    if (!config.enabled.get() || !config.injectDiaries.get()) return
    let text: string
    try {
      text = renderDiaryIndex(await listDiaries(root))
    } catch {
      // An unreadable diary directory must not fail session creation.
      return
    }
    if (text === '') return
    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin:plastic-memories' },
    }))
  })
}
