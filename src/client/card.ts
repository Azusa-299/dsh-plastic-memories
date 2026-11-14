/**
 * 角色卡导入/导出。纯函数，不碰 DOM，便于冒烟测试与将来复用到别处。
 *
 * 导出使用 Character Card V2 的字段名，`userName` 放在
 * `data.extensions['plastic-memories']`，这样 SillyTavern 一类的工具能读，
 * 本插件再导入时也不会丢字段。
 */

/** 设置页编辑的三项（不含 enabled，导入导出只处理人格内容）。 */
export interface CardValues {
  userName: string
  assistantName: string
  persona: string
}

/** 本插件在 V2 卡里保留自己字段所用的扩展键。 */
const EXTENSION_KEY = 'plastic-memories'

/**
 * 把当前人设导出成 Character Card V2 JSON。
 * @param values 当前三项。
 * @returns 可直接写盘的 JSON 文本（2 空格缩进）。
 */
export function toCardJson(values: CardValues): string {
  return JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: values.assistantName,
      description: values.persona,
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: 'Exported from dsh-plastic-memories',
      alternate_greetings: [],
      tags: ['dsh-plastic-memories'],
      extensions: { [EXTENSION_KEY]: { userName: values.userName } },
    },
  }, null, 2)
}

/**
 * 从角色卡 JSON 里取出三项：V2/V3 读 `data`，V1 与手写文件读顶层。
 * 只返回文件里确实存在的字段，未提供的保持设置页当前值。
 * @param text 文件内容。
 * @returns 待合并的字段；一个可用字段都没有时抛错。
 * @throws {Error} 内容不是 JSON，或既没有名字也没有人格正文。
 */
export function fromCardText(text: string): Partial<CardValues> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('not JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')

  const root = parsed as Record<string, unknown>
  const data = isRecord(root.data) ? root.data : root
  const name = textOf(data.name)
  // 描述与性格是 V2 卡里两段最常见的正文，合起来才是完整人设
  const persona = [textOf(data.description), textOf(data.personality)]
    .filter((part) => part !== '')
    .join('\n\n')
  if (name === '' && persona === '') throw new Error('no name or persona')

  const result: Partial<CardValues> = {}
  if (name !== '') result.assistantName = name
  if (persona !== '') result.persona = persona

  const own = isRecord(data.extensions) ? data.extensions[EXTENSION_KEY] : undefined
  const userName = isRecord(own) ? textOf(own.userName) : textOf(root.userName)
  if (userName !== '') result.userName = userName
  return result
}

/**
 * @param value 任意值。
 * @returns 它是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * @param value 任意值。
 * @returns 去空白后的字符串；非字符串返回空串。
 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
