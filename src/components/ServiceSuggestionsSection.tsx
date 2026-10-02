import { useServiceSuggestions } from '../hooks/useServiceSuggestions'
import { useState, useEffect } from 'react'
import type { AppLanguage } from '../i18n'
import { t } from '../i18n'
import type { ServiceSuggestion, SuggestionBlock } from '../types'
import { sanitizeRichText } from '../lib/richText'
import { MeetingSuggestions } from '../features/meetingNotes/MeetingHome'

// DB에서 오는 block.type 값 번역 맵
const BLOCK_TYPE_ZH: Record<string, string> = {
  '첫 방문': '第一次访问',
  '성서 연구': '圣经研究',
  '재방문': '回访',
  '정기방문': '固定续放',
  '일반': '一般',
}
const BLOCK_TYPE_EN: Record<string, string> = {
  '첫 방문': 'First Visit',
  '성서 연구': 'Bible Study',
  '재방문': 'Return Visit',
  '정기방문': 'Regular Visit',
  '일반': 'General',
}
function translateBlockType(type: string, language: AppLanguage): string {
  if (language === 'zh') return BLOCK_TYPE_ZH[type] ?? type
  if (language === 'en') return BLOCK_TYPE_EN[type] ?? type
  return type
}

export function ServiceSuggestionsSection({ language = 'ko' }: { language?: AppLanguage }) {
  const { suggestions, loading } = useServiceSuggestions()
  const [currentSuggestion, setCurrentSuggestion] = useState<ServiceSuggestion | null>(null)

  useEffect(() => {
    if (loading || !suggestions.length) return
    
    // Find all visible suggestions
    const visibleOnes = suggestions.filter(s => s.is_visible)
    if (visibleOnes.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- suggestions에서 현재 추천 파생(의도적)
      setCurrentSuggestion(null)
      return
    }

    // Sort by last_used_at descending, fallback to created_at
    visibleOnes.sort((a, b) => {
      const timeA = a.last_used_at ? new Date(a.last_used_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0)
      const timeB = b.last_used_at ? new Date(b.last_used_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0)
      return timeB - timeA
    })
    
    setCurrentSuggestion(visibleOnes[0])
  }, [suggestions, loading])

  return (
    <MeetingSuggestions language={language}>
    {loading ? <p>{t(language, 'meeting.loading')}</p> : !currentSuggestion || currentSuggestion.content.length === 0 ? <p>{t(language, 'suggestion.empty')}</p> :
    <section className="mobile-home-section" style={{ marginTop: 24 }}>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {currentSuggestion.content.map((block: SuggestionBlock, idx: number) => (
          <SuggestionCard key={idx} block={block} language={language} />
        ))}
      </div>
    </section>}
    </MeetingSuggestions>
  )
}

function SuggestionCard({ block, language = 'ko' }: { block: SuggestionBlock; language?: AppLanguage }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid var(--line-muted)', padding: 20, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 14, background: 'var(--bg-muted)', padding: '6px 10px', borderRadius: 6 }}>{translateBlockType(block.type, language)}</span>
      </div>

      {block.format === 'structured' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              {t(language, 'suggestion.question')}
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.6 }}>
              {block.question}
            </div>
          </div>

          <div style={{ background: 'var(--tint)', padding: 12, borderRadius: 12, border: '1px solid var(--line-muted)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              {t(language, 'suggestion.scripture')}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--brand)', lineHeight: 1.6 }}>
              {block.scripture}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              {t(language, 'suggestion.nextVisit')}
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.6 }}>
              {block.next_visit}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="sugg-rich"
          style={{ flex: 1, whiteSpace: 'pre-wrap', color: 'var(--ink)', lineHeight: 1.6, fontSize: 15, fontWeight: 500, wordBreak: 'break-word' }}
          dangerouslySetInnerHTML={{ __html: sanitizeRichText(block.body) }}
        />
      )}
    </div>
  )
}
