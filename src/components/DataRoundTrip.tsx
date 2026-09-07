// 방문 기록 / 세대 속성 — 엑셀(CSV) 왕복 편집 (PC 데이터 관리, 관리자·개발자)
//
// 설계 원칙: ID 기반 왕복 + 적용 전 미리보기
//  - 다운로드: 기록ID/세대ID 포함 CSV (참고 칸은 읽기전용 — 업로드 시 무시)
//  - 업로드: 값 검증(앱 어휘 그대로) → diff 미리보기(수정/추가/삭제/오류) → 확인 후 적용
//  - 건물 추가/삭제는 범위 밖 (기존 건물 CSV·앱에서) → 방문기록이 어긋날 위험 원천 차단
//
// DB 의미 매핑 (앱 동작과 동일):
//  - 방문 결과: visit_histories.result (만남/부재/대상외/거절/확인필요)
//  - 중국인: units.is_chinese / 세대메모: units.memo
//  - 방문금지: units.status '거절' ↔ '미방문' (updateUnitFlags 와 동일 규칙)
//  - 정기방문담당자: regular_visits (unit_id 로 delete 후 insert / 빈칸이면 해제)
import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../lib/toast'
import { confirmDialog } from '../lib/confirm'
import { getLocalDateString } from '../utils/dateUtils'
import { toCsv, parseCsv, normalizeDate, parseYN, isDeleteMark, VISIT_RESULTS, TIME_SLOTS, downloadCsvFile } from '../utils/roundTripCsv'
import { msg } from '../lib/msg'
import { getAuthToken } from '../lib/authToken'

// ── supabase 페이징 조회 (기본 1000행 제한 대응) ─────────────
async function fetchAllRows<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const page = 1000
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1)
    if (error) throw error
    const chunk = (data ?? []) as T[]
    out.push(...chunk)
    if (chunk.length < page) break
  }
  return out
}

// ── 참조 데이터 (세대 → 건물/카드) ───────────────────────────
type RefUnit = {
  id: number
  number: string
  status: string
  isChinese: boolean
  memo: string
  regularVisitor: string
  buildingName: string
  buildingType: string
  isRestaurant: boolean      // 건물에 식당이 있는지 (참고용)
  unitIsRestaurant: boolean  // 이 세대가 식당인지 (수정 대상)
  usageType: '' | '주택' | '상가'
  cardName: string
}

async function loadRefUnits(): Promise<Map<number, RefUnit>> {
  const cards = await fetchAllRows<{ id: number; name: string }>((f, t) =>
    supabase.from('cards').select('id, name').order('id').range(f, t))
  const buildings = await fetchAllRows<{ id: number; card_id: number; name: string; address: string; type: string; is_restaurant: boolean | null }>((f, t) =>
    supabase.from('buildings').select('id, card_id, name, address, type, is_restaurant').order('id').range(f, t))
  const units = await fetchAllRows<{ id: number; building_id: number; number: string; status: string; is_chinese: boolean | null; is_restaurant: boolean | null; usage_type: '주택' | '상가' | null; memo: string | null; regular_visits: { visitor_name: string }[] | null }>((f, t) =>
    supabase.from('units').select('id, building_id, number, status, is_chinese, is_restaurant, usage_type, memo, regular_visits(visitor_name)').order('id').range(f, t))

  const cardName = new Map(cards.map((c) => [c.id, c.name]))
  const bMap = new Map(buildings.map((b) => [b.id, b]))
  const map = new Map<number, RefUnit>()
  for (const u of units) {
    const b = bMap.get(u.building_id)
    map.set(u.id, {
      id: u.id,
      number: u.number ?? '',
      status: u.status ?? '미방문',
      isChinese: Boolean(u.is_chinese),
      memo: u.memo ?? '',
      regularVisitor: u.regular_visits?.[0]?.visitor_name ?? '',
      buildingName: b ? (b.name || b.address) : '',
      buildingType: b?.type ?? '',
      isRestaurant: Boolean(b?.is_restaurant),
      unitIsRestaurant: Boolean(u.is_restaurant),
      usageType: u.usage_type ?? '',
      cardName: b ? (cardName.get(b.card_id) ?? '') : '',
    })
  }
  return map
}

// ── 방문 기록 시트 ──────────────────────────────────────────
const VISIT_HEADERS = ['기록ID', '세대ID', '방문일', '시간대', '방문자', '결과', '메모', '삭제', '카드(참고)', '건물(참고)', '호수(참고)', '건물유형(참고)', '식당(참고)']

type RawVisitRow = { id: number; unit_id: number; visitor_name: string; result: string; time_slot: string | null; memo: string | null; visited_at: string; special_period_id: number | null }

type VisitPlan = {
  updates: Array<{ id: number; patch: Record<string, unknown>; current: RawVisitRow; label: string }>
  inserts: Array<{ row: Record<string, unknown>; label: string }>
  deletes: Array<{ id: number; label: string }>
  errors: Array<{ line: number; reason: string }>
  unchanged: number
}

type UnitPlan = {
  updates: Array<{ unitId: number; ops: { isChinese?: boolean; isRestaurant?: boolean; usageType?: '' | '주택' | '상가'; forbidden?: boolean; memo?: string; regular?: string | null }; label: string }>
  errors: Array<{ line: number; reason: string }>
  unchanged: number
}

// '식당' 은 수정 가능한 칸 (이 세대가 식당인가). 뒤쪽 (참고) 칸들은 읽기 전용
const UNIT_HEADERS = ['세대ID', '식당', '세대용도', '중국인', '방문금지', '정기방문담당자', '세대메모', '카드(참고)', '건물(참고)', '호수(참고)', '건물유형(참고)']

function headerIndex(header: string[], names: string[]): Map<string, number> | null {
  const idx = new Map<string, number>()
  for (const n of names) {
    const i = header.findIndex((h) => h.trim() === n)
    if (i < 0) return null
    idx.set(n, i)
  }
  return idx
}

export function DataRoundTrip() {
  const today = getLocalDateString()
  const monthStart = today.slice(0, 8) + '01'
  const [fromDate, setFromDate] = useState(monthStart)
  const [toDate, setToDate] = useState(today)
  const [busy, setBusy] = useState<string | null>(null)

  const [visitPlan, setVisitPlan] = useState<VisitPlan | null>(null)
  const [unitPlan, setUnitPlan] = useState<UnitPlan | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const visitFileRef = useRef<HTMLInputElement>(null)
  const unitFileRef = useRef<HTMLInputElement>(null)

  // ── 방문 기록 다운로드 ──
  const exportVisits = async () => {
    if (!fromDate || !toDate || fromDate > toDate) { showToast(msg('기간을 확인해 주세요'), 'error'); return }
    setBusy('visit-export')
    try {
      const refs = await loadRefUnits()
      const visits = await fetchAllRows<RawVisitRow>((f, t) =>
        supabase.from('visit_histories')
          .select('id, unit_id, visitor_name, result, time_slot, memo, visited_at, special_period_id')
          .is('invalidated_at', null)
          .gte('visited_at', fromDate).lte('visited_at', toDate)
          .order('visited_at').order('id').range(f, t))
      const rows: string[][] = [VISIT_HEADERS.slice()]
      for (const v of visits) {
        const r = refs.get(v.unit_id)
        rows.push([
          String(v.id), String(v.unit_id), v.visited_at ?? '', v.time_slot ?? '', v.visitor_name ?? '',
          v.result ?? '', v.memo ?? '', '',
          r?.cardName ?? '', r?.buildingName ?? '', r?.number ?? '', r?.buildingType ?? '', r?.isRestaurant ? 'Y' : '',
        ])
      }
      downloadCsvFile(`방문기록_${fromDate}_${toDate}.csv`, toCsv(rows))
      showToast(msg('방문 기록 {length}건 다운로드', { length: visits.length }))
    } catch (e) {
      console.error(e); showToast(msg('다운로드 실패'), 'error')
    } finally { setBusy(null) }
  }

  // ── 세대 속성 다운로드 ──
  const exportUnits = async () => {
    setBusy('unit-export')
    try {
      const refs = await loadRefUnits()
      const rows: string[][] = [UNIT_HEADERS.slice()]
      const sorted = [...refs.values()].sort((a, b) => a.cardName.localeCompare(b.cardName, 'ko') || a.buildingName.localeCompare(b.buildingName, 'ko'))
      for (const u of sorted) {
        rows.push([
          String(u.id), u.unitIsRestaurant ? 'Y' : '', u.usageType, u.isChinese ? 'Y' : '',
          u.status === '거절' ? 'Y' : '', u.regularVisitor, u.memo,
          u.cardName, u.buildingName, u.number, u.buildingType,
        ])
      }
      downloadCsvFile(`세대속성_${today}.csv`, toCsv(rows))
      showToast(msg('세대 {size}개 다운로드', { size: refs.size }))
    } catch (e) {
      console.error(e); showToast(msg('다운로드 실패'), 'error')
    } finally { setBusy(null) }
  }

  // ── 방문 기록 업로드 → 미리보기 ──
  const previewVisitFile = async (file: File) => {
    setBusy('visit-preview'); setVisitPlan(null); setApplied(null)
    try {
      const rows = parseCsv(await file.text())
      if (rows.length < 2) { showToast(msg('데이터 행이 없습니다'), 'error'); return }
      const idx = headerIndex(rows[0], ['기록ID', '세대ID', '방문일', '시간대', '방문자', '결과', '메모', '삭제'])
      if (!idx) { showToast(msg('헤더가 다릅니다. 다운로드한 파일 형식을 유지해 주세요'), 'error'); return }
      const refs = await loadRefUnits()

      const get = (r: string[], name: string) => (r[idx.get(name)!] ?? '').trim()
      const plan: VisitPlan = { updates: [], inserts: [], deletes: [], errors: [], unchanged: 0 }
      const idsInFile: number[] = []
      type Parsed = { line: number; id: number | null; unitId: number; date: string; slot: string; visitor: string; result: string; memo: string; del: boolean }
      const parsed: Parsed[] = []

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]
        const line = i + 1
        const idRaw = get(r, '기록ID')
        const id = idRaw === '' ? null : Number(idRaw)
        if (idRaw !== '' && (!Number.isInteger(id) || id! <= 0)) { plan.errors.push({ line, reason: `기록ID 형식 오류: "${idRaw}"` }); continue }
        const del = isDeleteMark(get(r, '삭제'))
        if (del === null) { plan.errors.push({ line, reason: `삭제 표시는 X 만 가능: "${get(r, '삭제')}"` }); continue }
        const unitId = Number(get(r, '세대ID'))
        if (!Number.isInteger(unitId) || !refs.has(unitId)) { plan.errors.push({ line, reason: `세대ID 없음: "${get(r, '세대ID')}"` }); continue }
        if (id !== null && del) { parsed.push({ line, id, unitId, date: '', slot: '', visitor: '', result: '', memo: '', del: true }); idsInFile.push(id); continue }
        const date = normalizeDate(get(r, '방문일')) ?? ''
        if (!date) { plan.errors.push({ line, reason: `방문일 형식 오류: "${get(r, '방문일')}"` }); continue }
        const slot = get(r, '시간대')
        if (!TIME_SLOTS.has(slot)) { plan.errors.push({ line, reason: `시간대는 오전/오후/저녁: "${slot}"` }); continue }
        const result = get(r, '결과')
        if (!VISIT_RESULTS.has(result)) { plan.errors.push({ line, reason: `결과 값 오류(만남/부재/대상외/거절/확인필요): "${result}"` }); continue }
        const visitor = get(r, '방문자')
        if (!visitor) { plan.errors.push({ line, reason: '방문자 이름이 비었습니다' }); continue }
        parsed.push({ line, id, unitId, date, slot, visitor, result, memo: get(r, '메모'), del: false })
        if (id !== null) idsInFile.push(id)
      }

      // 기존 행 조회 (수정/삭제 대상 존재 확인 + diff)
      const existing = new Map<number, RawVisitRow>()
      for (let i = 0; i < idsInFile.length; i += 500) {
        const chunk = idsInFile.slice(i, i + 500)
        const { data, error } = await supabase.from('visit_histories')
          .select('id, unit_id, visitor_name, result, time_slot, memo, visited_at, special_period_id')
          .in('id', chunk).is('invalidated_at', null)
        if (error) throw error
        for (const row of (data ?? []) as RawVisitRow[]) existing.set(row.id, row)
      }

      for (const p of parsed) {
        const r = refs.get(p.unitId)!
        const label = `${r.buildingName} ${r.number} · ${p.del ? '' : `${p.date} ${p.result} (${p.visitor})`}`
        if (p.id !== null && !existing.has(p.id)) { plan.errors.push({ line: p.line, reason: `기록ID ${p.id} 를 찾을 수 없습니다 (이미 삭제됨?)` }); continue }
        if (p.del) { plan.deletes.push({ id: p.id!, label: `${r.buildingName} ${r.number} · ${existing.get(p.id!)!.visited_at} ${existing.get(p.id!)!.result}` }); continue }
        if (p.id === null) {
          plan.inserts.push({ row: { unit_id: p.unitId, visitor_name: p.visitor, result: p.result, time_slot: p.slot, memo: p.memo || null, visited_at: p.date }, label })
          continue
        }
        const cur = existing.get(p.id)!
        const patch: Record<string, unknown> = {}
        if ((cur.visited_at ?? '') !== p.date) patch.visited_at = p.date
        if ((cur.time_slot ?? '') !== p.slot) patch.time_slot = p.slot
        if ((cur.visitor_name ?? '') !== p.visitor) patch.visitor_name = p.visitor
        if ((cur.result ?? '') !== p.result) patch.result = p.result
        if ((cur.memo ?? '') !== p.memo) patch.memo = p.memo || null
        if (Object.keys(patch).length === 0) { plan.unchanged++; continue }
        plan.updates.push({ id: p.id, patch, current: cur, label })
      }
      setVisitPlan(plan)
    } catch (e) {
      console.error(e); showToast(msg('파일 처리 실패'), 'error')
    } finally { setBusy(null) }
  }

  // ── 방문 기록 적용 ──
  const applyVisitPlan = async () => {
    if (!visitPlan) return
    const { updates, inserts, deletes } = visitPlan
    const ok = await confirmDialog({
      message: msg('방문 기록에 적용할까요?\n수정 {length} · 추가 {v1} · 무효 처리 {v2}\n무효 처리한 원본은 관리자 기록에 보존됩니다.\n(적용 전 백업(npm run backup)을 권장합니다)', { length: updates.length, v1: inserts.length, v2: deletes.length }),
      danger: deletes.length > 0,
      confirmLabel: '적용',
    })
    if (!ok) return
    setBusy('visit-apply')
    let done = 0; let failed = 0
    try {
      const token = getAuthToken()
      if (!token) throw new Error('로그인이 필요합니다')
      for (const item of deletes) {
        const { error } = await supabase.rpc('invalidate_visit_history_tx', {
          p_token: token, p_history_id: item.id, p_reason: '데이터 관리 CSV 정정',
        })
        if (error) failed++; else done++
      }
      for (const u of updates) {
        const next = { ...u.current, ...u.patch }
        const { error } = await supabase.rpc('update_visit_history_tx', {
          p_token: token,
          p_history_id: u.id,
          p_result: next.result,
          p_time_slot: next.time_slot,
          p_memo: next.memo ?? '',
          p_visited_at: next.visited_at,
          p_visitor_name: next.visitor_name,
          p_reason: '데이터 관리 CSV 정정',
        })
        if (error) failed++; else done++
      }
      for (let i = 0; i < inserts.length; i += 200) {
        const chunk = inserts.slice(i, i + 200).map((x) => x.row)
        const { error } = await supabase.from('visit_histories').insert(chunk)
        if (error) failed += chunk.length; else done += chunk.length
      }
      setVisitPlan(null)
      setApplied(`방문 기록 적용 완료: ${done}건 성공${failed ? ` · ${failed}건 실패` : ''}`)
      showToast(failed ? `${done}건 적용, ${failed}건 실패` : `${done}건 적용 완료`, failed ? 'error' : 'success')
    } finally { setBusy(null) }
  }

  // ── 세대 속성 업로드 → 미리보기 ──
  const previewUnitFile = async (file: File) => {
    setBusy('unit-preview'); setUnitPlan(null); setApplied(null)
    try {
      const rows = parseCsv(await file.text())
      if (rows.length < 2) { showToast(msg('데이터 행이 없습니다'), 'error'); return }
      const idx = headerIndex(rows[0], ['세대ID', '식당', '세대용도', '중국인', '방문금지', '정기방문담당자', '세대메모'])
      if (!idx) { showToast(msg('헤더가 다릅니다. 다운로드한 파일 형식을 유지해 주세요'), 'error'); return }
      const refs = await loadRefUnits()
      const get = (r: string[], name: string) => (r[idx.get(name)!] ?? '').trim()
      const plan: UnitPlan = { updates: [], errors: [], unchanged: 0 }

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]
        const line = i + 1
        const unitId = Number(get(r, '세대ID'))
        const ref = refs.get(unitId)
        if (!Number.isInteger(unitId) || !ref) { plan.errors.push({ line, reason: `세대ID 없음: "${get(r, '세대ID')}"` }); continue }
        const restaurant = parseYN(get(r, '식당'))
        if (restaurant === null) { plan.errors.push({ line, reason: `식당은 Y 또는 빈칸: "${get(r, '식당')}"` }); continue }
        const usageType = get(r, '세대용도')
        if (usageType !== '' && usageType !== '주택' && usageType !== '상가') {
          plan.errors.push({ line, reason: `세대용도는 주택·상가 또는 빈칸: "${usageType}"` }); continue
        }
        if (restaurant && usageType === '주택') {
          plan.errors.push({ line, reason: '식당 세대는 주택으로 지정할 수 없습니다' }); continue
        }
        const chinese = parseYN(get(r, '중국인'))
        if (chinese === null) { plan.errors.push({ line, reason: `중국인은 Y 또는 빈칸: "${get(r, '중국인')}"` }); continue }
        const forbidden = parseYN(get(r, '방문금지'))
        if (forbidden === null) { plan.errors.push({ line, reason: `방문금지는 Y 또는 빈칸: "${get(r, '방문금지')}"` }); continue }
        const regular = get(r, '정기방문담당자')
        const memo = get(r, '세대메모')

        const ops: UnitPlan['updates'][number]['ops'] = {}
        if (chinese !== ref.isChinese) ops.isChinese = chinese
        if (restaurant !== ref.unitIsRestaurant) ops.isRestaurant = restaurant
        const normalizedUsage = restaurant ? '상가' : usageType as '' | '주택' | '상가'
        if (normalizedUsage !== ref.usageType) ops.usageType = normalizedUsage
        const curForbidden = ref.status === '거절'
        if (forbidden !== curForbidden) ops.forbidden = forbidden
        if (memo !== ref.memo) ops.memo = memo
        if (regular !== ref.regularVisitor) ops.regular = regular === '' ? null : regular
        if (Object.keys(ops).length === 0) { plan.unchanged++; continue }
        const parts: string[] = []
        if (ops.isRestaurant !== undefined) parts.push(`식당 ${ops.isRestaurant ? 'Y' : 'N'}`)
        if (ops.usageType !== undefined) parts.push(`세대용도 ${ops.usageType || '건물 기본값'}`)
        if (ops.isChinese !== undefined) parts.push(`중국인 ${ops.isChinese ? 'Y' : 'N'}`)
        if (ops.forbidden !== undefined) parts.push(`방문금지 ${ops.forbidden ? 'Y' : 'N'}`)
        if (ops.regular !== undefined) parts.push(`정기방문 ${ops.regular ?? '해제'}`)
        if (ops.memo !== undefined) parts.push('메모')
        plan.updates.push({ unitId, ops, label: `${ref.buildingName} ${ref.number} · ${parts.join(', ')}` })
      }
      setUnitPlan(plan)
    } catch (e) {
      console.error(e); showToast(msg('파일 처리 실패'), 'error')
    } finally { setBusy(null) }
  }

  // ── 세대 속성 적용 ──
  const applyUnitPlan = async () => {
    if (!unitPlan) return
    const ok = await confirmDialog({
      message: msg('세대 속성 {length}개를 수정할까요?\n(적용 전 백업(npm run backup)을 권장합니다)', { length: unitPlan.updates.length }),
      confirmLabel: '적용',
    })
    if (!ok) return
    setBusy('unit-apply')
    let done = 0; let failed = 0
    try {
      for (const u of unitPlan.updates) {
        let rowOk = true
        const patch: Record<string, unknown> = {}
        if (u.ops.isChinese !== undefined) patch.is_chinese = u.ops.isChinese
        if (u.ops.isRestaurant !== undefined) patch.is_restaurant = u.ops.isRestaurant
        if (u.ops.usageType !== undefined) patch.usage_type = u.ops.usageType || null
        if (u.ops.memo !== undefined) patch.memo = u.ops.memo || null
        if (u.ops.forbidden !== undefined) patch.status = u.ops.forbidden ? '거절' : '미방문'
        if (Object.keys(patch).length > 0) {
          const { error } = await supabase.from('units').update(patch).eq('id', u.unitId)
          if (error) rowOk = false
        }
        if (rowOk && u.ops.regular !== undefined) {
          const del = await supabase.from('regular_visits').delete().eq('unit_id', u.unitId)
          if (del.error) rowOk = false
          else if (u.ops.regular) {
            const ins = await supabase.from('regular_visits').insert({ unit_id: u.unitId, visitor_name: u.ops.regular, registered_at: new Date().toISOString() })
            if (ins.error) rowOk = false
          }
        }
        if (rowOk) done++; else failed++
      }
      setUnitPlan(null)
      setApplied(`세대 속성 적용 완료: ${done}개 성공${failed ? ` · ${failed}개 실패` : ''}`)
      showToast(failed ? `${done}개 적용, ${failed}개 실패` : `${done}개 적용 완료`, failed ? 'error' : 'success')
    } finally { setBusy(null) }
  }

  // ── 미리보기 렌더 ──
  const renderPlanList = (title: string, items: Array<{ label?: string; reason?: string; line?: number }>, color: string) => {
    if (items.length === 0) return null
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 4 }}>{title} {items.length}</div>
        <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.slice(0, 100).map((it, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--gray-600)' }}>
              {it.line != null ? `${it.line}행: ` : ''}{it.label ?? it.reason}
            </div>
          ))}
          {items.length > 100 && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>… 외 {items.length - 100}건</div>}
        </div>
      </div>
    )
  }

  const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-card)', color: 'var(--gray-900)' }

  return (
    <>
      {/* ── 방문 기록 엑셀 왕복 ── */}
      <section className="desk-card ds-card">
        <h2 className="desk-card__title" style={{ marginBottom: 12 }}>방문 기록 엑셀 편집</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
          기간의 방문 기록(만남/부재/대상외 등)을 CSV로 내려받아 엑셀에서 수정·추가·무효 처리 후 다시 업로드합니다.
          기록ID로 행을 식별하며, 적용 전 변경 내용을 미리 보여줍니다. 참고(카드/건물 등) 칸 수정은 무시됩니다.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
          <span style={{ color: 'var(--gray-400)' }}>~</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
          <button className="ds-btn" type="button" disabled={busy !== null} onClick={() => void exportVisits()}>
            {busy === 'visit-export' ? '내려받는 중…' : 'CSV 다운로드'}
          </button>
          <button className="ds-btn" type="button" disabled={busy !== null} onClick={() => visitFileRef.current?.click()}>
            {busy === 'visit-preview' ? '분석 중…' : 'CSV 업로드'}
          </button>
          <input ref={visitFileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void previewVisitFile(f); e.target.value = '' }} />
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--gray-400)', lineHeight: 1.6 }}>
          수정: 방문일/시간대/방문자/결과/메모 · 삭제: 삭제 칸에 X · 추가: 기록ID 비우고 세대ID 입력.
          결과는 만남/부재/대상외/거절/확인필요, 시간대는 오전/오후/저녁만 허용됩니다.
        </p>
        {visitPlan && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 10, border: '1px solid var(--border-default)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-800)' }}>
              미리보기 — 수정 {visitPlan.updates.length} · 추가 {visitPlan.inserts.length} · 삭제 {visitPlan.deletes.length} · 변경없음 {visitPlan.unchanged} · 오류 {visitPlan.errors.length}
            </div>
            {renderPlanList('수정', visitPlan.updates, 'var(--primary-600, #1E5BD0)')}
            {renderPlanList('추가', visitPlan.inserts, 'var(--success-600, #059669)')}
            {renderPlanList('삭제', visitPlan.deletes, 'var(--status-danger, #C44536)')}
            {renderPlanList('오류 (적용 안 됨)', visitPlan.errors, 'var(--status-danger, #C44536)')}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="ds-btn ds-btn-primary" type="button"
                disabled={busy !== null || (visitPlan.updates.length + visitPlan.inserts.length + visitPlan.deletes.length === 0)}
                onClick={() => void applyVisitPlan()}>
                {busy === 'visit-apply' ? '적용 중…' : '적용'}
              </button>
              <button className="ds-btn" type="button" onClick={() => setVisitPlan(null)}>취소</button>
            </div>
          </div>
        )}
      </section>

      {/* ── 세대 속성 엑셀 왕복 ── */}
      <section className="desk-card ds-card">
        <h2 className="desk-card__title" style={{ marginBottom: 12 }}>세대 속성 엑셀 편집</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
          전체 세대의 <b>식당</b> / 중국인 / 방문금지 / 정기방문담당자 / 메모를 CSV로 내려받아 일괄 수정합니다.
          상가가 많아 하나씩 누르기 번거로울 때, 엑셀에서 상호명을 보며 식당 칸에 Y 를 채우면 한 번에 반영됩니다.
          세대 추가·삭제는 앱에서만 가능합니다 (방문 기록이 어긋나는 것을 막기 위해).
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="ds-btn" type="button" disabled={busy !== null} onClick={() => void exportUnits()}>
            {busy === 'unit-export' ? '내려받는 중…' : 'CSV 다운로드'}
          </button>
          <button className="ds-btn" type="button" disabled={busy !== null} onClick={() => unitFileRef.current?.click()}>
            {busy === 'unit-preview' ? '분석 중…' : 'CSV 업로드'}
          </button>
          <input ref={unitFileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void previewUnitFile(f); e.target.value = '' }} />
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--gray-400)', lineHeight: 1.6 }}>
          중국인/방문금지는 Y 또는 빈칸 · 정기방문담당자는 이름(빈칸 = 해제) · 방문금지 해제 시 상태는 미방문으로 돌아갑니다.
        </p>
        {unitPlan && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 10, border: '1px solid var(--border-default)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-800)' }}>
              미리보기 — 수정 {unitPlan.updates.length} · 변경없음 {unitPlan.unchanged} · 오류 {unitPlan.errors.length}
            </div>
            {renderPlanList('수정', unitPlan.updates, 'var(--primary-600, #1E5BD0)')}
            {renderPlanList('오류 (적용 안 됨)', unitPlan.errors, 'var(--status-danger, #C44536)')}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="ds-btn ds-btn-primary" type="button"
                disabled={busy !== null || unitPlan.updates.length === 0}
                onClick={() => void applyUnitPlan()}>
                {busy === 'unit-apply' ? '적용 중…' : '적용'}
              </button>
              <button className="ds-btn" type="button" onClick={() => setUnitPlan(null)}>취소</button>
            </div>
          </div>
        )}
      </section>

      {applied && (
        <section className="desk-card ds-card" style={{ borderColor: 'var(--success-500, #10B981)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)', marginBottom: 10 }}>{applied}</div>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--gray-500)' }}>
            앱 화면에 반영하려면 새로고침이 필요합니다.
          </p>
          <button className="ds-btn ds-btn-primary" type="button" onClick={() => window.location.reload()}>새로고침</button>
        </section>
      )}
    </>
  )
}
