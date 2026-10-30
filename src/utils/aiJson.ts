export function getAiResponseText(result: any): string {
  if (!result) return ''
  if (typeof result === 'string') return result

  const directCandidates = [
    result.response,
    result.text,
    result.output_text,
    result.generated_text,
    result.output,
    result.content,
  ]
  for (const value of directCandidates) {
    if (typeof value === 'string' && value.trim()) return value
  }

  const nested = [result.result, result.data, result.output]
  for (const item of nested) {
    if (!item) continue
    if (typeof item === 'string' && item.trim()) return item
    if (typeof item?.response === 'string' && item.response.trim()) return item.response
    if (typeof item?.text === 'string' && item.text.trim()) return item.text
    if (typeof item?.output_text === 'string' && item.output_text.trim()) return item.output_text
    if (typeof item?.generated_text === 'string' && item.generated_text.trim()) return item.generated_text
  }

  const choice = result.choices?.[0]
  const messageContent = choice?.message?.content
  if (typeof messageContent === 'string' && messageContent.trim()) return messageContent
  if (Array.isArray(messageContent)) {
    const parts = messageContent
      .map((part: any) => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')
      .filter(Boolean)
    if (parts.length) return parts.join('')
  }

  const nestedChoice = result.result?.choices?.[0]
  const nestedContent = nestedChoice?.message?.content
  if (typeof nestedContent === 'string' && nestedContent.trim()) return nestedContent

  return ''
}

/**
 * 尽量从模型输出中提取第一个合法 JSON 对象。
 * 兼容：
 *  - 纯 JSON
 *  - ```json ... ```
 *  - JSON 前后夹带解释文字
 *  - JSON 字符串内部包含 {} 的情况
 */
export function parseAiJson<T = any>(raw: unknown): T | null {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim()
  if (!text) return null

  const candidates: string[] = [text]

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) candidates.unshift(fenced[1].trim())

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') return parsed as T
    } catch {}
  }

  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue

    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < text.length; i++) {
      const ch = text[i]

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (ch === '\\') {
          escaped = true
        } else if (ch === '"') {
          inString = false
        }
        continue
      }

      if (ch === '"') {
        inString = true
      } else if (ch === '{') {
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0) {
          const candidate = text.slice(start, i + 1)
          try {
            const parsed = JSON.parse(candidate)
            if (parsed && typeof parsed === 'object') return parsed as T
          } catch {}
          break
        }
      }
    }
  }

  return null
}
