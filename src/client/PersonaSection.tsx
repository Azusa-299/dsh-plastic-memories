import { createElement, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fromCardText, toCardJson } from './card.ts'
import { DIARY_ROUTE } from '../route.ts'
import type { PersonaKey } from './locales.ts'

/** The fields written to the Host entry; names must match the Config keys. */
export interface PersonaValues {
  userName: string
  assistantName: string
  persona: string
  enabled: boolean
  /** Whether a new session starts with the diary title index. */
  injectDiaries: boolean
  /** Days of diary to keep; 0 keeps every file. */
  retainDays: number
}

/** Data and actions handed to the page by the registration's inject face. */
export interface PersonaSectionInjected {
  t: (key: PersonaKey) => string
  /** Current Host values, or undefined while the settings mirror is loading. */
  read: () => PersonaValues | undefined
  /** Whether the Host document currently accepts writes. */
  writable: () => boolean
  /** Notifies when the Host mirror changes; returns the unsubscribe function. */
  subscribe: (listener: () => void) => () => void
  /** Writes every field; true only when every write was accepted. */
  save: (patch: PersonaValues) => Promise<boolean>
}

export type PersonaSectionProps = PropsRuntime<'settings.section'> & PersonaSectionInjected

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'importFailed'

/** One diary name as the preview route lists it. */
interface DiarySummary {
  name: string
  lines: number
}

type DiaryStatus = 'loading' | 'ready' | 'unavailable'

const EMPTY: PersonaValues = { userName: '', assistantName: '', persona: '', enabled: true, injectDiaries: true, retainDays: 0 }

/** Retention choices shown next to the diary filters; 0 (keep all) is the off state. */
const RETAIN_DAYS = [30, 60, 90, 180, 365]

/** The `M月D日` prefix every diary name carries, or '' for an unrecognized name. */
function diaryDay(name: string): string {
  const match = /^(\d{1,2}月\d{1,2}日)/.exec(name)
  return match === null ? '' : match[1]
}

/** Comparable month/day key (`11月2日` and `11月02日` both become 1102). */
function dayKey(day: string): number | undefined {
  const match = /^(\d{1,2})月(\d{1,2})日$/.exec(day)
  return match === null ? undefined : Number(match[1]) * 100 + Number(match[2])
}

/**
 * Keep the diaries inside the inclusive month/day span. Endpoints are compared
 * without a year, so a reversed pair still selects the same days.
 * @param diaries - Every listed diary, newest first.
 * @param from - Start day label, or '' for no lower bound.
 * @param to - End day label, or '' for no upper bound.
 * @returns The diaries whose day falls inside the span.
 */
function inRange(diaries: DiarySummary[], from: string, to: string): DiarySummary[] {
  const fromKey = from === '' ? undefined : dayKey(from)
  const toKey = to === '' ? undefined : dayKey(to)
  if (fromKey === undefined && toKey === undefined) return diaries
  const low = fromKey !== undefined && toKey !== undefined ? Math.min(fromKey, toKey) : fromKey
  const high = fromKey !== undefined && toKey !== undefined ? Math.max(fromKey, toKey) : toKey
  return diaries.filter((diary) => {
    const key = dayKey(diaryDay(diary.name))
    // A name without a day tag cannot be placed; keep it visible rather than
    // letting a filter hide a file the user can still see on disk.
    if (key === undefined) return true
    if (low !== undefined && key < low) return false
    if (high !== undefined && key > high) return false
    return true
  })
}

/**
 * Settings page style sheet. Class names are namespaced because the page owns
 * its chrome; values come from the settings-page tokens so light, dark and the
 * host's own cards stay in step.
 */
const STYLES = `
.pm-section { display:flex; flex-direction:column; gap:16px; width:100%; padding:8px 0; font-size:13px; line-height:22px; color:var(--dsw-alias-label-primary); }
.pm-card { display:flex; flex-direction:column; gap:12px; padding:16px; border:0.5px solid var(--dsw-alias-settings-card-stroke); border-radius:var(--dsw-radius-xl); background:var(--dsw-alias-settings-card-fill); }
.pm-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
.pm-title { margin:0; font-size:14px; line-height:20px; font-weight:500; }
.pm-meta { flex:none; font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); font-variant-numeric:tabular-nums; }
.pm-switch { display:flex; align-items:center; gap:8px; width:fit-content; font-size:13px; line-height:20px; cursor:pointer; }
.pm-switch input { width:16px; height:16px; margin:0; accent-color:var(--dsw-alias-brand-primary); cursor:pointer; }
.pm-switch input:disabled { cursor:not-allowed; }
.pm-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; }
.pm-field { display:flex; flex-direction:column; gap:6px; min-width:0; }
.pm-label { font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
.pm-input, .pm-textarea { box-sizing:border-box; width:100%; padding:0 12px; border:0.5px solid var(--dsw-alias-border-l4); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; }
.pm-input { height:36px; }
.pm-textarea { min-height:140px; padding:8px 12px; line-height:22px; resize:vertical; }
.pm-input::placeholder, .pm-textarea::placeholder { color:var(--dsw-alias-label-tertiary); }
.pm-input:focus-visible, .pm-textarea:focus-visible { outline:none; border-color:var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)) 18%, transparent); }
.pm-input:disabled, .pm-textarea:disabled { opacity:0.5; cursor:not-allowed; }
.pm-hint { margin:0; font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.pm-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.pm-actions-end { display:flex; align-items:center; gap:8px; margin-left:auto; }
.pm-btn { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; height:36px; padding:0 14px; border:0.5px solid transparent; border-radius:var(--dsw-radius-md); background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:14px; line-height:22px; cursor:pointer; }
.pm-btn:disabled { opacity:0.4; cursor:not-allowed; }
.pm-btn:focus-visible { outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:2px; }
.pm-btn-outline { box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3); }
.pm-btn-primary { background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground); }
@media (hover: hover) {
  .pm-btn-outline:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
  .pm-btn-primary:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover); }
}
.pm-status { font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.pm-status[data-tone="success"] { color:var(--dsw-alias-state-success-primary); }
.pm-status[data-tone="error"] { color:var(--dsw-alias-state-error-primary); }
.pm-filter { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.pm-filter-field { display:flex; align-items:center; gap:6px; }
.pm-filter-switch { margin-left:auto; }
.pm-filter-note { font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.pm-filter-label { font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.pm-select { box-sizing:border-box; height:32px; padding:0 30px 0 10px; border:0.5px solid var(--dsw-alias-border-l4); border-radius:var(--dsw-radius-sm); background-color:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; line-height:20px; appearance:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 10px center; background-size:12px 12px; cursor:pointer; }
.pm-select:focus-visible { outline:none; border-color:var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)) 18%, transparent); }
.pm-select:disabled { opacity:0.5; cursor:not-allowed; }
.pm-btn-sm { height:32px; padding:0 10px; font-size:13px; line-height:20px; border-radius:var(--dsw-radius-sm); }
.pm-btn-ghost { color:var(--dsw-alias-label-secondary); }
@media (hover: hover) {
  .pm-btn-ghost:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
}
.pm-preview { display:grid; grid-template-columns:176px minmax(0, 1fr); gap:8px; height:260px; }
.pm-list { display:flex; flex-direction:column; gap:2px; padding:4px; overflow-y:auto; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); }
.pm-item { box-sizing:border-box; width:100%; padding:6px 8px; border:none; border-radius:var(--dsw-radius-sm); background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:13px; line-height:20px; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
.pm-item[aria-pressed="true"] { background:var(--dsw-alias-button-ghost-active-fill); color:var(--dsw-alias-label-primary); font-weight:500; }
@media (hover: hover) {
  .pm-item:hover:not([aria-pressed="true"]) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
}
.pm-viewer { display:flex; flex-direction:column; min-width:0; overflow:hidden; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); }
.pm-viewer-head { display:flex; align-items:center; justify-content:space-between; gap:8px; flex:none; padding:6px 12px; border-bottom:0.5px solid var(--dsw-alias-border-l2); font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.pm-viewer-body { flex:1; min-height:0; padding:10px 12px; overflow:auto; }
.pm-pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font-family:var(--dsw-font-family); font-size:13px; line-height:22px; }
.pm-empty { margin:0; padding:8px; font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.pm-skeleton { height:12px; margin:6px 8px; border-radius:var(--dsw-radius-xs); background:var(--dsw-alias-bg-skeleton); animation:pm-pulse 1.4s ease-in-out infinite; }
@keyframes pm-pulse { 0%, 100% { opacity:0.55; } 50% { opacity:1; } }
@media (prefers-reduced-motion: reduce) { .pm-skeleton { animation:none; } }
@media (max-width: 560px) {
  .pm-preview { grid-template-columns:1fr; height:auto; }
  .pm-list { max-height:160px; }
  .pm-viewer { height:220px; }
  .pm-actions-end { margin-left:0; width:100%; justify-content:flex-end; }
}
`

/**
 * Settings page holding the single persona.
 * Edits live in local state so a slow Host write never blocks typing; the page
 * only re-reads the Host mirror while the user has no unsaved edits.
 * @param props Slot props and the injected data face.
 * @returns The rendered page.
 */
export function PersonaSection({ t, read, writable, subscribe, save }: PersonaSectionProps): ReactNode {
  const [values, setValues] = useState<PersonaValues>(() => read() ?? EMPTY)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [writableNow, setWritableNow] = useState<boolean>(() => writable())
  // Set between the first edit and the next successful save, so a Host mirror
  // refresh cannot overwrite what the user is typing.
  const dirty = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const [diaries, setDiaries] = useState<DiarySummary[]>([])
  const [diaryStatus, setDiaryStatus] = useState<DiaryStatus>('loading')
  const [diaryName, setDiaryName] = useState('')
  const [diaryContent, setDiaryContent] = useState('')
  // Month/day endpoints of the list filter; '' means that end is unbounded.
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')

  // Every day the current list can be filtered by, newest first; the labels
  // double as the select options, so no date can be picked that has no diary.
  const diaryDays = [...new Set(diaries.map((diary) => diaryDay(diary.name)).filter((day) => day !== ''))]
  const visibleDiaries = inRange(diaries, fromDay, toDay)

  // The preview only lists and reads; creating, renaming and appending stay with
  // the model's tools, so the page cannot damage a diary.
  const loadDiaries = async (): Promise<void> => {
    setDiaryStatus('loading')
    try {
      const response = await fetch(DIARY_ROUTE, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json() as { diaries?: DiarySummary[] }
      const next = body.diaries ?? []
      setDiaries(next)
      setDiaryStatus('ready')
      // A diary can disappear between list and read; drop the stale text with it.
      if (diaryName !== '' && !next.some((diary) => diary.name === diaryName)) {
        setDiaryName('')
        setDiaryContent('')
      }
    } catch {
      // No route means this surface has no web server (desktop, headless).
      setDiaries([])
      setDiaryStatus('unavailable')
    }
  }

  const openDiary = async (name: string): Promise<void> => {
    setDiaryName(name)
    setDiaryContent('')
    if (name === '') return
    try {
      const response = await fetch(`${DIARY_ROUTE}?name=${encodeURIComponent(name)}`, {
        headers: { accept: 'application/json' },
      })
      const body = await response.json() as { selected?: { content: string } }
      setDiaryContent(body.selected?.content ?? '')
    } catch {
      setDiaryStatus('unavailable')
    }
  }

  useEffect(() => { void loadDiaries() }, [])

  // A filter can hide the open diary; close it instead of showing text for a
  // row the list no longer offers.
  useEffect(() => {
    if (diaryName === '') return
    if (visibleDiaries.some((diary) => diary.name === diaryName)) return
    setDiaryName('')
    setDiaryContent('')
  }, [diaryName, fromDay, toDay, diaries])

  useEffect(() => {
    const sync = (): void => {
      setWritableNow(writable())
      if (dirty.current) return
      const next = read()
      if (next !== undefined) setValues(next)
    }
    sync()
    return subscribe(sync)
  }, [read, writable, subscribe])

  const edit = (patch: Partial<PersonaValues>): void => {
    dirty.current = true
    setValues(current => ({ ...current, ...patch }))
    setStatus('idle')
  }

  const update = (key: 'userName' | 'assistantName' | 'persona', value: string): void => {
    if (key === 'userName') edit({ userName: value })
    else if (key === 'assistantName') edit({ assistantName: value })
    else edit({ persona: value })
  }

  const submit = async (): Promise<void> => {
    setStatus('saving')
    try {
      const ok = await save(values)
      if (ok) {
        dirty.current = false
        // The saved window decides the list length, so reload after a save.
        await loadDiaries()
      }
      setStatus(ok ? 'saved' : 'failed')
    } catch {
      // Transport failures reject; the draft stays so the user can retry.
      setStatus('failed')
    }
  }

  const importCard = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    // Reset first so picking the same file twice still fires a change event.
    event.target.value = ''
    if (file === undefined) return
    try {
      edit(fromCardText(await file.text()))
    } catch {
      setStatus('importFailed')
    }
  }

  const exportCard = (): void => {
    const blob = new Blob([toCardJson(values)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'persona-card.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const disabled = status === 'saving' || !writableNow

  const statusTone = status === 'saved' ? 'success' : status === 'failed' || status === 'importFailed' ? 'error' : 'neutral'
  const statusText = status === 'saved'
    ? t('saved')
    : status === 'failed'
      ? t('failed')
      : status === 'importFailed'
        ? t('importFailed')
        : !writableNow
          ? t('readonly')
          : ''

  const nameField = (key: 'userName' | 'assistantName', label: string, placeholder: string): ReactNode => (
    <label className="pm-field">
      <span className="pm-label">{label}</span>
      <input
        className="pm-input"
        type="text"
        value={values[key]}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  )

  return (
    <div className="pm-section">
      <style>{STYLES}</style>

      <section className="pm-card">
        <div className="pm-head">
          <h3 className="pm-title">{t('identity')}</h3>
        </div>
        <label className="pm-switch">
          <input
            type="checkbox"
            checked={values.enabled}
            disabled={disabled}
            onChange={(event) => { edit({ enabled: event.target.checked }) }}
          />
          <span>{t('enabled')}</span>
        </label>
        <div className="pm-grid">
          {nameField('userName', t('userName'), t('userNamePlaceholder'))}
          {nameField('assistantName', t('assistantName'), t('assistantNamePlaceholder'))}
        </div>
      </section>

      <section className="pm-card">
        <div className="pm-head">
          <h3 className="pm-title">{t('persona')}</h3>
          <span className="pm-meta">{values.persona.length} {t('chars')}</span>
        </div>
        <label className="pm-field">
          <textarea
            className="pm-textarea"
            value={values.persona}
            placeholder={t('personaPlaceholder')}
            aria-label={t('persona')}
            disabled={disabled}
            onChange={(event) => update('persona', event.target.value)}
          />
        </label>
        <p className="pm-hint">{t('macros')}</p>
      </section>

      <div className="pm-actions">
        <button type="button" className="pm-btn pm-btn-outline" disabled={disabled} onClick={() => fileInput.current?.click()}>
          {t('importCard')}
        </button>
        <button type="button" className="pm-btn pm-btn-outline" onClick={exportCard}>
          {t('exportCard')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(event) => void importCard(event)}
        />
        <div className="pm-actions-end">
          {statusText !== '' && <span className="pm-status" data-tone={statusTone} role="status">{statusText}</span>}
          <button type="button" className="pm-btn pm-btn-primary" disabled={disabled} onClick={() => void submit()}>
            {status === 'saving' ? t('saving') : t('save')}
          </button>
        </div>
      </div>

      <section className="pm-card">
        <div className="pm-head">
          <h3 className="pm-title">{t('diaryPreview')}</h3>
          {diaryStatus === 'ready' && diaries.length > 0 && (
            <span className="pm-meta">
              {fromDay !== '' || toDay !== ''
                ? `${visibleDiaries.length} / ${diaries.length}`
                : t('diaryCount').replace('{n}', String(diaries.length))}
            </span>
          )}
        </div>
        <div className="pm-filter">
          <label className="pm-filter-field">
            <span className="pm-filter-label">{t('retainDays')}</span>
            <select
              className="pm-select"
              value={String(values.retainDays)}
              disabled={disabled}
              onChange={(event) => { edit({ retainDays: Number(event.target.value) }) }}
            >
              <option value="0">{t('retainForever')}</option>
              {RETAIN_DAYS.map((days) => (
                <option key={days} value={String(days)}>
                  {t('retainOption').replace('{n}', String(days))}
                </option>
              ))}
            </select>
          </label>
          <span className="pm-filter-note">{t('retainHint')}</span>
        </div>
        {diaryStatus !== 'unavailable' && (
          <div className="pm-filter">
            <label className="pm-filter-field">
              <span className="pm-filter-label">{t('dateFrom')}</span>
              <select
                className="pm-select"
                value={fromDay}
                disabled={diaryDays.length === 0}
                onChange={(event) => { setFromDay(event.target.value) }}
              >
                <option value="">{t('allDates')}</option>
                {diaryDays.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
            </label>
            <label className="pm-filter-field">
              <span className="pm-filter-label">{t('dateTo')}</span>
              <select
                className="pm-select"
                value={toDay}
                disabled={diaryDays.length === 0}
                onChange={(event) => { setToDay(event.target.value) }}
              >
                <option value="">{t('allDates')}</option>
                {diaryDays.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
            </label>
            {(fromDay !== '' || toDay !== '') && (
              <button
                type="button"
                className="pm-btn pm-btn-ghost pm-btn-sm"
                onClick={() => { setFromDay(''); setToDay('') }}
              >{t('clearFilter')}</button>
            )}
            <label className="pm-switch pm-filter-switch">
              <input
                type="checkbox"
                checked={values.injectDiaries}
                disabled={disabled}
                onChange={(event) => { edit({ injectDiaries: event.target.checked }) }}
              />
              <span>{t('injectDiaries')}</span>
            </label>
          </div>
        )}
        <div className="pm-preview">
          <div className="pm-list" role="group" aria-label={t('diaryPreview')}>
            {diaryStatus === 'loading' && (
              <>
                <span className="pm-skeleton" style={{ width: '72%' }} />
                <span className="pm-skeleton" style={{ width: '88%' }} />
                <span className="pm-skeleton" style={{ width: '60%' }} />
                <span className="pm-skeleton" style={{ width: '80%' }} />
              </>
            )}
            {diaryStatus === 'ready' && diaries.length === 0 && <p className="pm-empty">{t('diaryEmpty')}</p>}
            {diaryStatus === 'ready' && diaries.length > 0 && visibleDiaries.length === 0 && (
              <p className="pm-empty">{t('diaryNoMatch')}</p>
            )}
            {diaryStatus === 'ready' && visibleDiaries.map((diary) => (
              <button
                key={diary.name}
                type="button"
                className="pm-item"
                title={`${diary.name} · ${diary.lines}`}
                aria-pressed={diary.name === diaryName}
                onClick={() => { void openDiary(diary.name) }}
              >{diary.name}</button>
            ))}
          </div>
          <div className="pm-viewer">
            {diaryName !== '' && (
              <div className="pm-viewer-head"><span>{diaryName}</span></div>
            )}
            <div className="pm-viewer-body">
              {diaryStatus === 'unavailable'
                ? <p className="pm-empty">{t('diaryUnavailable')}</p>
                : diaryContent !== ''
                  ? <pre className="pm-pre">{diaryContent}</pre>
                  : <p className="pm-empty">{t('diarySelect')}</p>}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
