/**
 * Model-facing diary tools: append a note, list diaries, read one diary.
 * They only ever write today's file; existing diaries stay untouched.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import { appendNote, listDiaries, pruneDiaries, readDiary, tailLines } from './diary.ts'

/**
 * Register the three diary tools on the host context.
 * @param ctx - plugin context; registrations are effects scoped to it.
 * @param root - absolute diary directory.
 * @param now - clock used to stamp notes; tests replace it for determinism.
 * @param retainDays - reads the retention window; notes prune expired files after they land.
 */
export function registerDiaryTools(
  ctx: Context,
  root: string,
  now: () => Date = () => new Date(),
  retainDays: () => number = () => 0,
): void {
  ctx.tools.register(defineTool({
    name: 'diary_note',
    description: 'Append one short line to today\'s diary, stamped with the local time. '
      + 'Only today\'s file is modified. The day\'s first note passes `summary` (a short recap that names the day); '
      + 'later calls may pass a better one to rename today\'s file.',
    parameters: {
      note: {
        type: 'string', required: true,
        description: 'One short sentence, no line breaks, in the user\'s language.',
      },
      summary: {
        type: 'string',
        description: 'Short day recap for the file name; required on the day\'s first note.',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          file: { type: 'string', required: true },
          line: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
        },
      },
      render: () => [{ type: 'text', text: 'success' }],
    },
    async execute(args) {
      const result = await appendNote(root, now(), args.note, args.summary)
      try {
        await pruneDiaries(root, retainDays(), now())
      } catch {
        // The note is already on disk; a cleanup failure must not report it as lost.
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'diary_read',
    description: 'Read a diary. Omit `name` to list every diary with its line count; pass a `name` from that list '
      + '(with or without .md, or a unique fragment such as `11月12日`) to get its text. '
      + 'Very long diaries return only their latest 200 lines.',
    parameters: {
      name: {
        type: 'string',
        description: 'Diary name or a unique fragment; omit to list diaries.',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          diaries: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                lines: { type: 'integer', required: true },
              },
            },
          },
          name: { type: 'string' },
          content: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: Array.isArray(value.diaries)
          ? (value.diaries.length === 0
            ? 'No diaries yet.'
            : value.diaries
              .map((entry: { name: string; lines: number }) => `${entry.name} (${entry.lines} line${entry.lines === 1 ? '' : 's'})`)
              .join('\n'))
          : `<diary>${value.name}</diary>\n<content>\n${value.content}</content>`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.name === undefined || args.name.trim() === '') {
        return { diaries: await listDiaries(root) }
      }
      const diary = await readDiary(root, args.name)
      return { ...diary, content: tailLines(diary.content) }
    },
  }))
}
