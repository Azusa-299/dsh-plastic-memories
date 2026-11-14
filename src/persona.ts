/**
 * 把三项配置拼成注入系统提示的片段。
 * 三项皆空、或人格被关闭时返回空串：段仍注册但内容为空，等价于不注入。
 * @param userName 用户想被称呼的名字。
 * @param assistantName agent 自己的名字。
 * @param persona 人格正文，可含 `{{user}}` / `{{char}}` 变量。
 * @param enabled 关掉后整段不注入。
 * @returns 注入文本，可能为空串。
 */
export function renderPersona(
  userName: string,
  assistantName: string,
  persona: string,
  enabled = true,
): string {
  if (!enabled) return ''

  const user = userName.trim()
  const self = assistantName.trim()
  const body = expandMacros(persona.trim(), user, self)
  if (user === '' && self === '' && body === '') return ''

  const lines: string[] = []
  // 指令行用英文（提示词语言），名字用双引号包住，避免名字带标点时读起来断裂
  if (user !== '') lines.push(`Address the user as "${user}".`)
  // 说明这句是"用户怎么称呼你"，避免和上一行的"用户称呼"混淆
  if (self !== '') lines.push(`Your name is "${self}"; the user calls you by it.`)
  if (body !== '') lines.push(body)
  return lines.join('\n')
}

/**
 * 展开角色卡生态通用的两个变量，让导入的卡片文本可以直接使用。
 * 对应名字为空时回退到英文通用说法，保持提示词语言一致。
 * @param text 人格正文。
 * @param user 用户名字，可能为空。
 * @param self agent 名字，可能为空。
 * @returns 展开后的正文。
 */
function expandMacros(text: string, user: string, self: string): string {
  if (text === '') return ''
  return text
    .replaceAll('{{user}}', user === '' ? 'the user' : user)
    .replaceAll('{{char}}', self === '' ? 'the assistant' : self)
}
