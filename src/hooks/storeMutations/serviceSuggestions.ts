import { ensureAffectedRows, supabase } from './shared'
import type { SuggestionBlock } from '../../types'
import { sanitizeRichText } from '../../lib/richText'
import { invalidateHomeSuggestion } from '../homeServiceSuggestion'

// 자유양식 본문의 리치텍스트를 저장 전 정제 (XSS 방지 + 클린 저장)
function sanitizeContent(content: SuggestionBlock[]): SuggestionBlock[] {
  return content.map((block) =>
    block.format === 'free_text'
      ? { ...block, body: sanitizeRichText(block.body) }
      : block,
  )
}

export async function saveServiceSuggestion(input: {
  id?: number
  title: string
  show_title_on_home: boolean
  tags: string[]
  is_visible: boolean
  content: SuggestionBlock[]
}): Promise<boolean> {
  const payload: Record<string, unknown> = {
    title: input.title,
    show_title_on_home: input.show_title_on_home,
    tags: input.tags,
    is_visible: input.is_visible,
    content: sanitizeContent(input.content),
  }
  if (input.is_visible) {
    // If we are turning it on, update last_used_at
    payload.last_used_at = new Date().toISOString()
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('service_suggestions')
      .update(payload)
      .eq('id', input.id)
      .select('id')
    if (error) throw error
    invalidateHomeSuggestion()
    return ensureAffectedRows(data, '대화 방법 제안을 수정하지 못했습니다.')
  } else {
    const { data, error } = await supabase.from('service_suggestions').insert(payload).select('id')
    if (error) throw error
    invalidateHomeSuggestion()
    return ensureAffectedRows(data, '대화 방법 제안을 추가하지 못했습니다.')
  }
}

export async function deleteServiceSuggestion(id: number): Promise<boolean> {
  const { data, error } = await supabase.from('service_suggestions').delete().eq('id', id).select('id')
  if (error) throw error
  invalidateHomeSuggestion()
  return ensureAffectedRows(data, '대화 방법 제안을 삭제하지 못했습니다.')
}
