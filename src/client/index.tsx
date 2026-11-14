import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect imports: they merge `locale`, `configForms` and the
// `settings.section` slot into the client Context for type checking.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// The `slots` registry is provided by the renderer; its module augments Context.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PersonaSection, type PersonaSectionInjected, type PersonaValues } from './PersonaSection.tsx'
import { en, zh } from './locales.ts'

export const name = 'plastic-memories'

/** Registering the page needs slots, labels need the locale service, values need configForms. */
export const inject = ['slots', 'locale', 'configForms']

/** Row id, Settings namespace and section id all use this one string. */
const NS = 'plastic-memories'

// Card helpers are exported for the smoke test; the page imports them directly.
export { fromCardText, toCardJson } from './card.ts'

/**
 * Registers the persona page below Settings.
 * @param ctx Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plastic-memories: dictionaries')
  // Bound once and reused: `bind` caches per namespace, and the same function is
  // what the registration's label and the page's copy both resolve through.
  const t = ctx.locale.bind(NS)

  // `slots.inject` waits for the settings shell to declare `settings.section`,
  // so a missing Settings plugin leaves the page absent instead of failing apply.
  ctx.slots.inject('settings.section', () => {
    const form = ctx.configForms.get<PersonaValues>(NS)

    return ctx.slots.register({
      name: 'settings.section',
      id: NS,
      order: 40,
      label: () => t('nav'),
      inject: (): PersonaSectionInjected => ({
        t,
        read: () => {
          const snapshot = form.getSnapshot()
          if (snapshot.status !== 'ready' || snapshot.value === undefined) return undefined
          // Entries saved before `enabled` existed omit it; a missing value
          // means "inject", which is the schema default.
          return {
            ...snapshot.value,
            enabled: snapshot.value.enabled !== false,
            injectDiaries: snapshot.value.injectDiaries !== false,
            retainDays: snapshot.value.retainDays ?? 0,
          }
        },
        writable: () => form.getSnapshot().writable,
        subscribe: (listener) => form.subscribe(() => listener()),
        // Field writes stay separate so a refused field is identifiable; the
        // controller already queues them and fences every write by revision.
        save: async (patch) => {
          const userName = await form.set('userName', patch.userName)
          const assistantName = await form.set('assistantName', patch.assistantName)
          const persona = await form.set('persona', patch.persona)
          const enabled = await form.set('enabled', patch.enabled)
          const injectDiaries = await form.set('injectDiaries', patch.injectDiaries)
          const retainDays = await form.set('retainDays', patch.retainDays)
          return userName && assistantName && persona && enabled && injectDiaries && retainDays
        },
      }),
    }, PersonaSection)
  })
}
