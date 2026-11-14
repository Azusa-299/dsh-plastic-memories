import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Live persona settings; every field is editable from the Settings page. */
export interface Config {
  /** How the user wants to be addressed. */
  userName: Volatile<string>
  /** The name the assistant answers to. */
  assistantName: Volatile<string>
  /** Free-form persona and style instructions; may use `{{user}}` / `{{char}}`. */
  persona: Volatile<string>
  /** Whether the persona section is injected at all. */
  enabled: Volatile<boolean>
  /** Whether a new session starts with the list of diary titles injected. */
  injectDiaries: Volatile<boolean>
  /** Days of diary to keep; 0 keeps every diary. Older files are deleted. */
  retainDays: Volatile<number>
  /** Absolute diary directory; empty means `<DSH_HOME>/plastic-memories/diary`. */
  diaryRoot: string
}

/** Schema for the single persona; volatile fields update without remounting the plugin. */
export const Config = z.object({
  userName: z.string().default('').volatile(),
  assistantName: z.string().default('').volatile(),
  persona: z.string().default('').volatile(),
  enabled: z.boolean().default(true).volatile(),
  injectDiaries: z.boolean().default(true).volatile(),
  retainDays: z.number().min(0).max(3650).default(0).volatile(),
  diaryRoot: z.string().default(''),
})
