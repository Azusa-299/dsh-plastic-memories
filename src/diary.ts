/**
 * Diary storage: one Markdown file per day under `<root>/MM月DD日-<summary>.md`.
 * Every note is one line stamped with the local wall clock, so a diary reads
 * chronologically and stays append-only for any day except today.
 */
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One stored diary, as listed by `diary_read` without a name. */
export interface DiaryEntry {
  /** File name without the `.md` extension, e.g. `11月12日-主人说喜欢猫娘`. */
  name: string
  /** Number of non-empty note lines. */
  lines: number
}

/** One accepted note. */
export interface NoteResult {
  /** File name with the `.md` extension. */
  file: string
  /** The stamp plus text exactly as appended. */
  line: string
  /** Whether this call created today's diary. */
  created: boolean
}

/** Characters that are illegal in a Windows file name. */
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g

/** Longest summary kept in a file name, in characters. */
const MAX_SUMMARY = 40

/** File extension used for every diary. */
export const DIARY_EXT = '.md'

/** Most titles one injected index lists before folding the rest into a count. */
const MAX_INDEX_ENTRIES = 40

/**
 * Render the diary index injected when a session starts.
 * @param entries - Diaries newest first, as `listDiaries` returns them.
 * @param limit - Most titles to list; older ones fold into one count line.
 * @returns The index text, or '' when the diary is empty.
 */
export function renderDiaryIndex(entries: DiaryEntry[], limit = MAX_INDEX_ENTRIES): string {
  if (entries.length === 0) return ''
  const shown = entries.slice(0, limit)
  const older = entries.length - shown.length
  const tail = older === 0 ? '' : `…and ${older} older ${older === 1 ? 'one' : 'ones'}.`
  return [
    'Your diaries, newest first:',
    ...shown.map((entry) => `${entry.name} (${entry.lines} line${entry.lines === 1 ? '' : 's'})`),
    tail,
    'Call diary_read with a name to read one.',
  ].filter((line) => line !== '').join('\n')
}

/**
 * Local calendar tag for one day.
 * @param date - the moment to name.
 * @returns `MM月DD日` without zero padding, matching the file-name convention.
 */
export function dateTag(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/**
 * Local wall-clock stamp for one note.
 * @param date - the moment to stamp.
 * @returns Hour, minute and second joined by dots, e.g. `8.00.01`.
 */
export function clockStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getHours()}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
}

/**
 * Make a summary safe to use as the suffix of a file name.
 * @param summary - the model-supplied recap.
 * @returns The summary with path separators replaced, whitespace collapsed and
 * length capped; may be empty.
 */
export function sanitizeSummary(summary: string): string {
  return summary
    .replace(UNSAFE_NAME, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, MAX_SUMMARY)
    .trim()
}

/**
 * Build today's file name.
 * @param date - the day the diary belongs to.
 * @param summary - recap used as the suffix.
 * @returns File name such as `11月12日-主人说喜欢猫娘.md`.
 */
export function diaryFileName(date: Date, summary: string): string {
  return `${dateTag(date)}-${sanitizeSummary(summary)}${DIARY_EXT}`
}

/**
 * List every diary under one root, newest first.
 * @param root - diary directory.
 * @returns Entries with their line counts; an absent directory lists as empty.
 */
export async function listDiaries(root: string): Promise<DiaryEntry[]> {
  let files: string[]
  try {
    files = await readdir(root)
  } catch (error) {
    if (isCode(error, 'ENOENT')) return []
    throw error
  }
  const entries: DiaryEntry[] = []
  for (const file of files) {
    if (!file.endsWith(DIARY_EXT)) continue
    const content = await readFile(join(root, file), 'utf8')
    entries.push({
      name: file.slice(0, -DIARY_EXT.length),
      lines: content.split('\n').filter(line => line.trim() !== '').length,
    })
  }
  return entries.sort((a, b) => rank(b.name) - rank(a.name) || b.name.localeCompare(a.name, 'zh-CN', { numeric: true }))
}

/**
 * Append one note to today's diary, creating the file on the first note of the day.
 * @param root - diary directory.
 * @param date - the moment the note is written for.
 * @param note - one line of text, without line breaks.
 * @param summary - optional recap; required to create the file and used to
 * rename today's file when it differs from the current name.
 * @returns The file name, the appended line and whether the file was created.
 */
export async function appendNote(root: string, date: Date, note: string, summary?: string): Promise<NoteResult> {
  const text = note.trim()
  if (text === '') throw new Error('diary_note requires a non-empty note')
  if (text.includes('\n') || text.includes('\r')) {
    throw new Error('diary_note writes exactly one line per call; remove the line break')
  }

  const line = `${clockStamp(date)}: ${text}`
  const tag = dateTag(date)
  const today = (await listDiaries(root)).filter(entry => entry.name === tag || entry.name.startsWith(`${tag}-`))
  const clean = summary === undefined ? '' : sanitizeSummary(summary)

  if (today.length > 0) {
    const current = today[0]
    await appendFile(join(root, `${current.name}${DIARY_EXT}`), `${line}\n`, 'utf8')
    if (clean === '' || clean === current.name.slice(tag.length + 1)) {
      return { file: `${current.name}${DIARY_EXT}`, line, created: false }
    }
    const target = `${tag}-${clean}`
    await renameDiary(root, current.name, target)
    return { file: `${target}${DIARY_EXT}`, line, created: false }
  }

  if (clean === '') {
    throw new Error(
      `No diary exists for ${tag} yet. Pass a short summary so the new file can be named ${tag}-<summary>.md`,
    )
  }
  await mkdir(root, { recursive: true })
  const name = `${tag}-${clean}`
  try {
    await writeFile(join(root, `${name}${DIARY_EXT}`), `${line}\n`, { encoding: 'utf8', flag: 'wx' })
    return { file: `${name}${DIARY_EXT}`, line, created: true }
  } catch (error) {
    // Another writer created the file between the listing and the write.
    if (!isCode(error, 'EEXIST')) throw error
    await appendFile(join(root, `${name}${DIARY_EXT}`), `${line}\n`, 'utf8')
    return { file: `${name}${DIARY_EXT}`, line, created: false }
  }
}

/**
 * Read one diary by name.
 * @param root - diary directory.
 * @param name - full name with or without `.md`, or a unique fragment such as the date.
 * @returns The resolved name and the full file content.
 */
export async function readDiary(root: string, name: string): Promise<{ name: string; content: string }> {
  const wanted = name.trim().replace(/\.md$/i, '')
  if (wanted === '') throw new Error('diary_read requires a diary name')
  const entries = await listDiaries(root)
  const exact = entries.find(entry => entry.name === wanted)
  const matches = exact === undefined ? entries.filter(entry => entry.name.includes(wanted)) : [exact]
  if (matches.length === 0) {
    throw new Error(`No diary matches "${name}". Call diary_read without a name to list the existing diaries.`)
  }
  if (matches.length > 1) {
    throw new Error(
      `"${name}" matches several diaries: ${matches.map(entry => entry.name).join('; ')}. Pass the full name.`,
    )
  }
  const content = await readFile(join(root, `${matches[0].name}${DIARY_EXT}`), 'utf8')
  return { name: matches[0].name, content }
}

/**
 * Keep the newest lines of a diary so one long file cannot flood a request.
 * @param content - full diary text.
 * @param max - number of trailing lines to keep.
 * @returns The kept text, prefixed with a note when earlier lines were dropped.
 */
export function tailLines(content: string, max = 200): string {
  if (content === '') return ''
  const lines = content.replace(/\n$/, '').split('\n')
  if (lines.length <= max) return content
  return `…(${lines.length - max} earlier lines omitted)\n${lines.slice(-max).join('\n')}\n`
}

/**
 * Delete diaries that fall outside the retention window.
 *
 * Names carry no year, so each one is dated to its most recent occurrence:
 * a month/day later than today belongs to last year. A name without a date
 * prefix is never deleted, and the cutoff day itself counts as retained.
 * @param root - diary directory.
 * @param retainDays - days to keep, counting today; 0 or less keeps everything.
 * @param now - the moment the window ends.
 * @returns Names that were deleted.
 */
export async function pruneDiaries(root: string, retainDays: number, now: Date): Promise<string[]> {
  if (!Number.isFinite(retainDays) || retainDays <= 0) return []
  const entries = await listDiaries(root)
  const cutoff = startOfDay(now)
  cutoff.setDate(cutoff.getDate() - Math.floor(retainDays))
  const removed: string[] = []
  for (const entry of entries) {
    const day = occurrenceDate(entry.name, now)
    if (day === null || day.getTime() >= cutoff.getTime()) continue
    await unlink(join(root, `${entry.name}${DIARY_EXT}`))
    removed.push(entry.name)
  }
  return removed
}

/** Midnight at the start of the day containing `date`. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Most recent calendar occurrence of a diary's `MM月DD日` prefix, or null when it has none. */
function occurrenceDate(name: string, now: Date): Date | null {
  const match = /^(\d{1,2})月(\d{1,2})日/.exec(name)
  if (match === null) return null
  const month = Number(match[1]) - 1
  const day = Number(match[2])
  const candidate = new Date(now.getFullYear(), month, day)
  const today = startOfDay(now)
  if (candidate.getTime() > today.getTime()) candidate.setFullYear(now.getFullYear() - 1)
  return candidate
}

/** Rename today's file, refusing to overwrite another diary. */
async function renameDiary(root: string, from: string, to: string): Promise<void> {
  try {
    await rename(join(root, `${from}${DIARY_EXT}`), join(root, `${to}${DIARY_EXT}`))
  } catch (error) {
    if (isCode(error, 'EEXIST') || isCode(error, 'EPERM')) {
      throw new Error(`Cannot rename today's diary to "${to}": that file already exists. Pick another summary.`)
    }
    throw error
  }
}

/** Numeric rank of a date tag so newest diaries sort first. */
function rank(name: string): number {
  const match = /^(\d{1,2})月(\d{1,2})日/.exec(name)
  return match === null ? 0 : Number(match[1]) * 100 + Number(match[2])
}

/** Whether a filesystem error carries the given code. */
function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}
