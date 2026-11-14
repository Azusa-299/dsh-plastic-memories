// The lookup chain and `bind` are keyed by this map, so registering a new
// namespace requires merging it in; without this the namespace argument is not
// assignable to `keyof LocaleNamespaceMap`.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'plastic-memories': PersonaKey
  }
}

/** Locale dictionary keys registered by the client half. */
export type PersonaKey =
  | 'nav'
  | 'userName'
  | 'userNamePlaceholder'
  | 'assistantName'
  | 'assistantNamePlaceholder'
  | 'persona'
  | 'personaPlaceholder'
  | 'save'
  | 'saving'
  | 'saved'
  | 'failed'
  | 'identity'
  | 'readonly'
  | 'enabled'
  | 'macros'
  | 'importCard'
  | 'exportCard'
  | 'importFailed'
  | 'diaryPreview'
  | 'diarySelect'
  | 'diaryEmpty'
  | 'diaryUnavailable'
  | 'diaryCount'
  | 'chars'
  | 'dateFrom'
  | 'dateTo'
  | 'allDates'
  | 'clearFilter'
  | 'diaryNoMatch'
  | 'injectDiaries'
  | 'retainDays'
  | 'retainForever'
  | 'retainOption'
  | 'retainHint'

export const zh: Record<PersonaKey, string> = {
  nav: '个性化人设',
  userName: '用户称呼',
  userNamePlaceholder: '你如何称呼用户，例如：灭建国',
  assistantName: 'agent的名字',
  assistantNamePlaceholder: 'agent 的名字，例如：灭霸',
  persona: '人格设定',
  personaPlaceholder: '例如：回答简洁，先给结论；不确定的事先问再做。',
  save: '保存',
  saving: '保存中…',
  saved: '已保存',
  failed: '保存失败',
  readonly: '当前配置不可写',
  identity: '身份',
  enabled: '启用人格',
  macros: '人格正文可用 {{user}} 表示用户称呼，{{char}} 表示你的名字',
  importCard: '导入角色卡',
  exportCard: '导出',
  importFailed: '导入失败：不是有效的角色卡文件',
  diaryPreview: '日记预览',
  diarySelect: '选择一篇日记',
  diaryEmpty: '还没有日记',
  diaryUnavailable: '日记预览不可用（仅 Web 端支持）',
  diaryCount: '{n} 篇',
  chars: '字符',
  dateFrom: '从',
  dateTo: '到',
  allDates: '全部日期',
  clearFilter: '清除筛选',
  diaryNoMatch: '没有符合日期范围的日记',
  injectDiaries: '新会话注入日记目录',
  retainDays: '保留时长',
  retainForever: '永久保留',
  retainOption: '{n} 天',
  retainHint: '保存后生效；更早的日记在你下次记日记时删除',
}

export const en: Record<PersonaKey, string> = {
  nav: 'Personal persona',
  userName: 'User name',
  userNamePlaceholder: 'How you address the user, e.g. Alex',
  assistantName: 'agent name',
  assistantNamePlaceholder: 'The agent name, e.g. Nova',
  persona: 'Persona',
  personaPlaceholder: 'e.g. Answer concisely, lead with the conclusion, ask before guessing.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Save failed',
  readonly: 'This configuration is read-only',
  identity: 'Identity',
  enabled: 'Enable persona',
  macros: 'The persona text may use {{user}} for the user name and {{char}} for your name',
  importCard: 'Import character card',
  exportCard: 'Export',
  importFailed: 'Import failed: not a valid character card file',
  diaryPreview: 'Diary preview',
  diarySelect: 'Select a diary',
  diaryEmpty: 'No diaries yet',
  diaryUnavailable: 'Diary preview is unavailable here (Web only)',
  diaryCount: '{n} diaries',
  chars: 'characters',
  dateFrom: 'From',
  dateTo: 'To',
  allDates: 'All dates',
  clearFilter: 'Clear filter',
  diaryNoMatch: 'No diaries in this date range',
  injectDiaries: 'List diaries at session start',
  retainDays: 'Retention',
  retainForever: 'Keep all',
  retainOption: '{n} days',
  retainHint: 'Applies on save; older diaries are deleted with your next note',
}

