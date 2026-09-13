import { useState, useMemo, useRef } from 'react'
import type { AppLanguage } from '../../i18n'
import type { SuggestionBlock, ServiceSuggestion } from '../../types'
import { saveServiceSuggestion, deleteServiceSuggestion } from '../../hooks/storeMutations/serviceSuggestions'
import { useServiceSuggestions } from '../../hooks/useServiceSuggestions'
import { confirmDialog, alertDialog } from '../../lib/confirm'
import { RichTextEditor } from '../RichTextEditor'
import { msg } from '../../lib/msg'

type Props = {
  language?: AppLanguage
}

// ── CSV 내보내기 ──────────────────────────────────────────────
const CSV_HEADERS = ['id', '제목', '태그', '홈노출', '노출여부', '블록번호', '블록유형명', '포맷', '질문', '성구', '다음방문기초', '자유내용']

function escapeCSV(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function suggestionsToCSV(suggestions: ServiceSuggestion[]): string {
  const rows: string[][] = []
  for (const s of suggestions) {
    const base = [String(s.id), s.title, s.tags.join('|'), s.show_title_on_home ? '1' : '0', s.is_visible ? '1' : '0']
    if (s.content.length === 0) {
      rows.push([...base, '0', '', '', '', '', '', ''])
    } else {
      s.content.forEach((block, idx) => {
        rows.push([
          ...base,
          String(idx),
          block.type,
          block.format,
          block.format === 'structured' ? block.question : '',
          block.format === 'structured' ? block.scripture : '',
          block.format === 'structured' ? block.next_visit : '',
          block.format === 'free_text' ? block.body : '',
        ])
      })
    }
  }
  const lines = [CSV_HEADERS.map(escapeCSV).join(','), ...rows.map((r) => r.map(escapeCSV).join(','))]
  return lines.join('\n')
}

function downloadSuggestionsCSV(suggestions: ServiceSuggestion[]) {
  const content = suggestionsToCSV(suggestions)
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `suggestions_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── 샘플 CSV 다운로드 ─────────────────────────────────────────
function downloadSampleCSV() {
  const rows = [
    CSV_HEADERS,
    // 단일 블록 제안 (structured)
    ['', '첫방문- 하느님,고통', '하느님', '0', '1', '0', '첫 방문', 'structured', '성경이 오늘날에도 도움이 될까요?', '딤후 3:16', '성경에는 어떤 내용이 들어 있을까요?', ''],
    // 단일 블록 제안 (structured, 질문·다음방문 생략)
    ['', '재방문', '성경', '0', '1', '0', '재방문', 'structured', '', '시 37:29', '', ''],
    // 단일 블록 제안 (free_text)
    ['', '성경연구', '', '0', '0', '0', '성서연구', 'free_text', '', '', '', '——'],
    // 다중 블록 제안 (structured + free_text) — 같은 제목으로 묶임
    ['', '혼합형 예시', '', '0', '1', '0', '', 'structured', '', '계 21:4', '', ''],
    ['', '혼합형 예시', '', '0', '1', '1', '', 'free_text', '', '', '', ''],
  ]
  const content = rows.map((r) => r.map(escapeCSV).join(',')).join('\n')
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'suggestions_sample.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── CSV 파싱 → ServiceSuggestion 배열 ────────────────────────
type ParsedSuggestion = Omit<ServiceSuggestion, 'created_at'> & { id: number }

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
      else if (ch === '"') inQuote = false
      else current += ch
    } else {
      if (ch === '"') inQuote = true
      else if (ch === ',') { result.push(current); current = '' }
      else current += ch
    }
  }
  result.push(current)
  return result
}

function csvToSuggestions(csv: string): { suggestions: ParsedSuggestion[]; errors: string[] } {
  const lines = csv.split('\n').map((l) => l.replace(/\r$/, ''))
  if (lines.length < 2) return { suggestions: [], errors: ['내용이 비어있습니다'] }

  // 헤더 확인
  const header = parseCSVLine(lines[0])
  const expectedCols = CSV_HEADERS.length
  if (header.length < expectedCols) {
    return { suggestions: [], errors: [`헤더 열 수 불일치 (예상 ${expectedCols}, 실제 ${header.length})`] }
  }

  const errors: string[] = []
  // id(또는 제목) 기준으로 그룹화
  const groups = new Map<string, { meta: string[]; blocks: string[][] }>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = parseCSVLine(line)
    if (cols.length < expectedCols) { errors.push(`${i + 1}번 행: 열 수 부족`); continue }
    const id = cols[0].trim()
    const title = cols[1].trim()
    const key = id || title
    if (!key) { errors.push(`${i + 1}번 행: id와 제목 모두 비어있음`); continue }
    if (!groups.has(key)) {
      groups.set(key, { meta: cols, blocks: [] })
    }
    const fmt = cols[7].trim()
    // 블록 데이터가 있을 때만 추가 (빈 블록 행 제외)
    if (fmt === 'structured' || fmt === 'free_text') {
      groups.get(key)!.blocks.push(cols)
    }
  }

  const suggestions: ParsedSuggestion[] = []
  for (const [, { meta, blocks }] of groups) {
    const id = Number(meta[0]) || 0
    const title = meta[1].trim()
    if (!title) { errors.push(`제목 없음 스킵`); continue }
    const tags = meta[2] ? meta[2].split('|').map((t) => t.trim()).filter(Boolean) : []
    const showTitle = meta[3] === '1'
    const isVisible = meta[4] === '1'

    // 블록 번호 기준 정렬
    const sortedBlocks = [...blocks].sort((a, b) => Number(a[5]) - Number(b[5]))
    const content: SuggestionBlock[] = sortedBlocks.map((cols) => {
      const fmt = cols[7].trim() as 'structured' | 'free_text'
      const type = cols[6].trim() || '기타'
      if (fmt === 'structured') {
        return { type, format: 'structured', question: cols[8], scripture: cols[9], next_visit: cols[10] }
      }
      return { type, format: 'free_text', body: cols[11] }
    })

    suggestions.push({ id, title, show_title_on_home: showTitle, tags, is_visible: isVisible, last_used_at: null, content })
  }

  return { suggestions, errors }
}

function formatDate(isoStr?: string | null) {
  if (!isoStr) return '사용 이력 없음'
  const d = new Date(isoStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export function AdminSuggestions(_props: Props) {
  const { suggestions, loading, fetchSuggestions } = useServiceSuggestions()
  const [editingSuggestion, setEditingSuggestion] = useState<Partial<ServiceSuggestion> | null>(null)
  const [saving, setSaving] = useState(false)

  // Search & Pagination state
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null)
  const itemsPerPage = 10

  // Tag Input State
  const [tagInput, setTagInput] = useState('')

  // CSV import state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importPreview, setImportPreview] = useState<ParsedSuggestion[] | null>(null)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)

  const filteredSuggestions = useMemo(() => {
    return suggestions.filter(s => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      const matchTitle = s.title.toLowerCase().includes(q)
      const matchTag = s.tags.some(tag => tag.toLowerCase().includes(q))
      return matchTitle || matchTag
    })
  }, [suggestions, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredSuggestions.length / itemsPerPage))
  const paginatedSuggestions = filteredSuggestions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const handleCreateNew = () => {
    setEditingSuggestion({
      title: '',
      show_title_on_home: false,
      tags: [],
      is_visible: false,
      content: []
    })
  }

  const handleEdit = (sugg: ServiceSuggestion) => {
    setEditingSuggestion({ ...sugg, tags: [...sugg.tags] })
  }

  const handleSave = async () => {
    if (!editingSuggestion) return
    if (!editingSuggestion.title?.trim()) {
      void alertDialog({ message: '제목을 입력해주세요.' })
      return
    }

    setSaving(true)
    try {
      const saved = await saveServiceSuggestion({
        id: editingSuggestion.id,
        title: editingSuggestion.title,
        show_title_on_home: editingSuggestion.show_title_on_home ?? false,
        tags: editingSuggestion.tags ?? [],
        is_visible: editingSuggestion.is_visible ?? false,
        content: editingSuggestion.content ?? []
      })
      if (!saved) return
      await fetchSuggestions()
      setEditingSuggestion(null)
    } catch (err) {
      console.error(err)
      void alertDialog({ message: '저장 실패' })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleVisible = async (sugg: ServiceSuggestion, nextVisible: boolean) => {
    try {
      const saved = await saveServiceSuggestion({
        id: sugg.id,
        title: sugg.title,
        show_title_on_home: sugg.show_title_on_home,
        tags: sugg.tags,
        is_visible: nextVisible,
        content: sugg.content
      })
      if (!saved) return
      await fetchSuggestions()
    } catch (err) {
      console.error(err)
      void alertDialog({ message: '상태 변경 실패' })
    }
  }

  const handleDelete = async (id: number) => {
    if (!(await confirmDialog({ message: '정말 이 제안 묶음을 삭제하시겠습니까?', danger: true, confirmLabel: '삭제' }))) return
    try {
      const deleted = await deleteServiceSuggestion(id)
      if (!deleted) return
      await fetchSuggestions()
      if (editingSuggestion?.id === id) {
        setEditingSuggestion(null)
      }
    } catch (err) {
      console.error(err)
      void alertDialog({ message: '삭제 실패' })
    }
  }

  const handleUpdateBlock = (index: number, updates: Partial<SuggestionBlock>) => {
    if (!editingSuggestion) return
    const newContent = [...(editingSuggestion.content || [])]
    newContent[index] = { ...newContent[index], ...updates } as SuggestionBlock
    setEditingSuggestion({ ...editingSuggestion, content: newContent })
  }

  const handleRemoveBlock = (index: number) => {
    if (!editingSuggestion) return
    const newContent = [...(editingSuggestion.content || [])]
    newContent.splice(index, 1)
    setEditingSuggestion({ ...editingSuggestion, content: newContent })
  }

  const handleAddStructured = () => {
    if (!editingSuggestion) return
    setEditingSuggestion({
      ...editingSuggestion,
      content: [...(editingSuggestion.content || []), { type: '첫 방문', format: 'structured', question: '', scripture: '', next_visit: '' }]
    })
  }

  const handleAddFreeText = () => {
    if (!editingSuggestion) return
    setEditingSuggestion({
      ...editingSuggestion,
      content: [...(editingSuggestion.content || []), { type: '기타 제안', format: 'free_text', body: '' }]
    })
  }

  const handleAddTag = () => {
    if (!editingSuggestion || !tagInput.trim()) return
    const newTags = [...(editingSuggestion.tags || [])]
    if (!newTags.includes(tagInput.trim())) {
      newTags.push(tagInput.trim())
      setEditingSuggestion({ ...editingSuggestion, tags: newTags })
    }
    setTagInput('')
  }

  const handleRemoveTag = (tagToRemove: string) => {
    if (!editingSuggestion) return
    setEditingSuggestion({
      ...editingSuggestion,
      tags: (editingSuggestion.tags || []).filter(t => t !== tagToRemove)
    })
  }

  // CSV 파일 선택 → 파싱 → 미리보기
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? ''
      const { suggestions: parsed, errors } = csvToSuggestions(text)
      setImportPreview(parsed)
      setImportErrors(errors)
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  // 미리보기 확인 → DB 저장
  const handleImportConfirm = async () => {
    if (!importPreview || importPreview.length === 0) return
    setImporting(true)
    let ok = 0
    let fail = 0
    for (const s of importPreview) {
      try {
        const saved = await saveServiceSuggestion({
          id: s.id || undefined,
          title: s.title,
          show_title_on_home: s.show_title_on_home,
          tags: s.tags,
          is_visible: s.is_visible,
          content: s.content,
        })
        if (saved) ok++
        else fail++
      } catch {
        fail++
      }
    }
    await fetchSuggestions()
    setImporting(false)
    setImportPreview(null)
    setImportErrors([])
    void alertDialog({
      message: msg('가져오기 완료: {ok}건 저장{failText}', {
        ok,
        failText: fail ? msg(', {fail}건 실패', { fail }) : '',
      }),
    })
  }

  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' as const, gap: '10px', padding: '16px', borderRadius: '10px', background: 'var(--surface)', marginBottom: '10px', border: '1px solid var(--line-muted)' }
  const actionBtnStyle = (danger?: boolean) => ({ padding: '5px 12px', border: `1px solid var(--line-muted)`, borderRadius: '6px', background: 'var(--bg)', color: danger ? 'var(--status-danger)' : 'var(--text)', fontSize: '12px', fontWeight: 600 as const, cursor: 'pointer' })
  const inputStyle = { padding: '10px 12px', border: '1px solid var(--line-muted)', borderRadius: '6px', background: 'var(--bg)', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, color: 'var(--ink)' }
  const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }

  if (editingSuggestion) {
    const blocks = editingSuggestion.content || []
    const isVisible = editingSuggestion.is_visible

    return (
      <div style={{ maxWidth: 640, margin: '0 auto', paddingBottom: 60 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
            {editingSuggestion.id ? '제안 수정' : '새 제안 작성'}
          </h2>
          <button onClick={() => setEditingSuggestion(null)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', fontWeight: 600, cursor: 'pointer', padding: '4px 8px' }}>
            목록으로
          </button>
        </div>

        <div className="detail-card" style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>제안 제목 (관리용)</label>
            <input 
              type="text" 
              value={editingSuggestion.title} 
              onChange={(e) => setEditingSuggestion({ ...editingSuggestion, title: e.target.value })}
              style={inputStyle}
              placeholder="예: 3월 첫째주 봉사 제안"
            />
          </div>
          


          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>검색용 태그 (선택)</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input 
                type="text" 
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if(e.key === 'Enter') handleAddTag() }}
                style={{ ...inputStyle, flex: 1 }}
                placeholder="태그 입력 후 Enter"
              />
              <button onClick={handleAddTag} type="button" style={{ ...actionBtnStyle(), padding: '0 16px' }}>추가</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(editingSuggestion.tags || []).map(tag => (
                <span key={tag} style={{ background: 'var(--bg-muted)', border: '1px solid var(--line-muted)', borderRadius: 20, padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  #{tag}
                  <button onClick={() => handleRemoveTag(tag)} type="button" style={{ border: 'none', background: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>×</button>
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--line-muted)', marginBottom: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>홈 화면 노출 활성화</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 13, color: isVisible ? 'var(--brand)' : 'var(--text-muted)', fontWeight: 600 }}>{isVisible ? 'ON' : 'OFF'}</span>
              <input 
                type="checkbox" 
                checked={isVisible} 
                onChange={(e) => setEditingSuggestion({ ...editingSuggestion, is_visible: e.target.checked })} 
                style={{ width: 20, height: 20, accentColor: 'var(--brand)', cursor: 'pointer' }} 
              />
            </label>
          </div>
        </div>

        <div className="detail-card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>제안 블록 내용</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleAddStructured} type="button" style={{ ...actionBtnStyle(), color: 'var(--brand)', borderColor: 'var(--brand)' }}>
                + 폼 추가
              </button>
              <button onClick={handleAddFreeText} type="button" style={actionBtnStyle()}>
                + 자유 양식
              </button>
            </div>
          </div>

          {blocks.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, textAlign: 'center', padding: '24px 0' }}>위 버튼을 눌러 대화 방법을 추가해주세요.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {blocks.map((block, idx) => (
                <div key={idx}>
                  {block.format === 'structured' ? (
                    <div style={{ background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--line-muted)', padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px dashed var(--line-muted)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)' }}>#{idx + 1} 구조 폼</span>
                          <input 
                            type="text" 
                            value={block.type} 
                            onChange={(e) => handleUpdateBlock(idx, { type: e.target.value })}
                            style={{ width: 120, padding: '6px 10px', fontSize: 13, border: '1px solid var(--line-muted)', borderRadius: 6, fontWeight: 700, background: 'var(--surface)' }}
                            placeholder="유형명 (예: 첫 방문)"
                          />
                        </div>
                        <button onClick={() => handleRemoveBlock(idx)} style={{ background: 'none', border: 'none', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 8px' }}>
                          삭제
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div>
                          <label style={labelStyle}>질문</label>
                          <input 
                            type="text" 
                            value={block.question} 
                            onChange={(e) => handleUpdateBlock(idx, { question: e.target.value })}
                            style={inputStyle}
                            placeholder="예: 성경이 오늘날에도 도움이 될까요?"
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>성구</label>
                          <input 
                            type="text" 
                            value={block.scripture} 
                            onChange={(e) => handleUpdateBlock(idx, { scripture: e.target.value })}
                            style={inputStyle}
                            placeholder="예: 딤후 3:16"
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>다음 방문 기초</label>
                          <input 
                            type="text" 
                            value={block.next_visit} 
                            onChange={(e) => handleUpdateBlock(idx, { next_visit: e.target.value })}
                            style={inputStyle}
                            placeholder="예: 성경에는 어떤 내용이 들어 있을까요?"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '0 4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)' }}>#{idx + 1} 자유 양식</span>
                          <input 
                            type="text" 
                            value={block.type} 
                            onChange={(e) => handleUpdateBlock(idx, { type: e.target.value })}
                            style={{ width: 150, padding: '4px 8px', fontSize: 13, border: '1px solid var(--line-muted)', borderRadius: 6, fontWeight: 700, background: 'var(--surface)', color: 'var(--ink)' }}
                            placeholder="유형명 (예: 성서 연구)"
                          />
                        </div>
                        <button onClick={() => handleRemoveBlock(idx)} style={{ background: 'none', border: 'none', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}>
                          블록 삭제
                        </button>
                      </div>
                      <RichTextEditor
                        value={block.body}
                        onChange={(html) => handleUpdateBlock(idx, { body: html })}
                        placeholder="대화 방법 본문을 자유롭게 작성해 주세요. (텍스트를 선택하고 굵게/밑줄/색 버튼)"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          style={{ width: '100%', padding: '14px', background: 'var(--ink)', color: '#fff', border: 'none', fontWeight: 600, borderRadius: 10, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 15, opacity: saving ? 0.5 : 1 }}
        >
          {saving ? '저장 중...' : '저장하기'}
        </button>
      </div>
    )
  }

  // --- List View ---
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', paddingBottom: 60 }}>
      {/* CSV 가져오기 미리보기 패널 */}
      {importPreview && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ color: '#15803d', fontSize: 14 }}>가져오기 미리보기 — {importPreview.length}건</strong>
            <button onClick={() => { setImportPreview(null); setImportErrors([]) }} type="button"
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>취소</button>
          </div>
          {importErrors.length > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#dc2626' }}>
              경고: {importErrors.join(' / ')}
            </div>
          )}
          <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
            {importPreview.map((s, i) => (
              <div key={i} style={{ padding: '8px 10px', background: '#fff', borderRadius: 6, marginBottom: 6, border: '1px solid #d1fae5', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {s.id ? <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>ID {s.id} 덮어쓰기</span>
                    : <span style={{ fontSize: 11, color: '#15803d', background: '#dcfce7', padding: '1px 6px', borderRadius: 4 }}>신규</span>}
                  <strong style={{ color: '#1e293b' }}>{s.title}</strong>
                  {s.is_visible && <span style={{ fontSize: 10, color: '#2563eb', background: '#dbeafe', padding: '1px 6px', borderRadius: 4 }}>노출 ON</span>}
                </div>
                <div style={{ color: '#64748b', marginTop: 3 }}>블록 {s.content.length}개 · 태그: {s.tags.join(', ') || '없음'}</div>
              </div>
            ))}
          </div>
          <button onClick={handleImportConfirm} disabled={importing} type="button"
            style={{ width: '100%', padding: '10px', background: '#15803d', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.6 : 1 }}>
            {importing ? '저장 중...' : `${importPreview.length}건 저장하기`}
          </button>
        </div>
      )}

      <div className="detail-card" style={{ marginBottom: '16px' }}>
        <div className="suggestion-admin-toolbar">
          <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: 'var(--ink)', flexShrink: 0, whiteSpace: 'nowrap' }}>대화 방법 제안 관리</h2>
          <div className="suggestion-admin-actions">
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} style={{ display: 'none' }} />
            <details className="suggestion-csv-menu">
              <summary>CSV 관리</summary>
              <div>
                <button onClick={downloadSampleCSV} type="button">샘플 받기</button>
                <button onClick={() => fileInputRef.current?.click()} type="button">가져오기</button>
                <button onClick={() => downloadSuggestionsCSV(suggestions)} disabled={suggestions.length === 0} type="button">내보내기</button>
              </div>
            </details>
            <button className="suggestion-create-button" onClick={handleCreateNew} type="button">+ 새 제안</button>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="제목 또는 태그로 검색..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            style={{ ...inputStyle, borderRadius: 8, padding: '10px 12px', background: 'var(--bg-muted)' }}
          />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>불러오는 중...</div>
        ) : filteredSuggestions.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, textAlign: 'center', padding: '30px 0' }}>
            등록된 제안이 없거나 검색 결과가 없습니다.
          </p>
        ) : (
          <div>
            {paginatedSuggestions.map((sugg) => (
              <div key={sugg.id} style={{ ...rowStyle, borderLeft: sugg.is_visible ? '4px solid var(--brand)' : '1px solid var(--line-muted)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: '15px', color: sugg.is_visible ? 'var(--ink)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sugg.title}
                    </strong>
                    {sugg.is_visible && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--brand)', background: 'var(--tint)', padding: '2px 6px', borderRadius: 4 }}>ON</span>}
                  </div>
                  
                  {sugg.tags && sugg.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {sugg.tags.map(tag => (
                        <span key={tag} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-muted)', padding: '2px 6px', borderRadius: 4 }}>#{tag}</span>
                      ))}
                    </div>
                  )}

                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>
                    최근 사용: {formatDate(sugg.last_used_at)}
                  </div>
                </div>

                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === sugg.id ? null : sugg.id) }} 
                    type="button" 
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, fontWeight: 800, cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}
                  >
                    ⋮
                  </button>
                  {activeMenuId === sugg.id && (
                    <>
                      <div onClick={() => setActiveMenuId(null)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
                      <div style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--surface)', border: '1px solid var(--line-muted)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, minWidth: 120, padding: 4, display: 'flex', flexDirection: 'column' }}>
                        <button onClick={() => { handleToggleVisible(sugg, !sugg.is_visible); setActiveMenuId(null); }} type="button" style={{ padding: '10px 12px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 4, color: sugg.is_visible ? 'var(--text-muted)' : 'var(--brand)' }}>
                          {sugg.is_visible ? '홈 노출 끄기' : '홈 노출 켜기'}
                        </button>
                        <div style={{ height: 1, background: 'var(--bg-muted)', margin: '2px 0' }} />
                        <button onClick={() => { handleEdit(sugg); setActiveMenuId(null); }} type="button" style={{ padding: '10px 12px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 4, color: 'var(--ink)' }}>수정</button>
                        <button onClick={() => { handleDelete(sugg.id); setActiveMenuId(null); }} type="button" style={{ padding: '10px 12px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 4, color: 'var(--status-danger)' }}>삭제</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i + 1)}
                style={{
                  width: 32, height: 32, borderRadius: '50%', border: 'none',
                  background: currentPage === i + 1 ? 'var(--ink)' : 'var(--bg-muted)',
                  color: currentPage === i + 1 ? '#fff' : 'var(--text)',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer'
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
