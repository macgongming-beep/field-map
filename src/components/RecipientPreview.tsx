import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createRecipientPreview } from '../lib/recipientPreview'
import type { CardSummary } from '../lib/cardSummaries'
import type { RecipientCardDetails } from '../lib/recipientCardPrefetch'
import { toBuilding, toCardBoundary } from '../hooks/storeTransforms'
import type { Building, CalendarEvent, CardBoundary, TerritoryCard } from '../types'
import { assignedServiceScope, cardServiceLabel, scopeServiceBuildings } from '../utils/cardServiceScope'
import { msg } from '../lib/msg'
import { MapCanvas } from './MapCanvas'
import './RecipientPreview.css'

function PreviewIcon({ kind }: { kind: 'back' | 'map' | 'list' | 'refresh' }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'back' ? <path d="m14 5-7 7 7 7" /> : kind === 'map' ? <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" /><path d="M9 3v16M15 5v16" /></> : kind === 'refresh' ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" /></> : <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.1M3 12h.1M3 18h.1" /></>}
  </svg>
}

function AssignmentPreview({ event, userName }: { event: CalendarEvent; userName: string }) {
  const { ids, scope } = assignedServiceScope(event, userName)
  const scopeKey = ids.join(',')
  const [summaries, setSummaries] = useState<CardSummary[] | null>(null)
  const [details, setDetails] = useState<RecipientCardDetails | null>(null)
  const [error, setError] = useState(false)
  const [view, setView] = useState<'list' | 'map'>('list')
  const [cardId, setCardId] = useState<number | null>(null)
  const [selectedBuildingId, setSelectedBuildingId] = useState(0)
  useEffect(() => {
    let api: ReturnType<typeof createRecipientPreview> | undefined
    let disposed = false
    void Promise.resolve().then(() => {
      if (disposed) return
      api = createRecipientPreview(userName)
      const load = api.reader.prefetch(scopeKey.split(',').filter(Boolean).map(Number))
      void load.summaries.then((rows) => { if (!disposed) setSummaries(rows) }).catch(() => { if (!disposed) setError(true) })
      return load.details.then((data) => { if (!disposed) setDetails(data) })
    }).catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true; api?.dispose() }
  }, [scopeKey, userName])
  const buildings = useMemo(() => {
    const selection = assignedServiceScope(event, userName, cardId ?? undefined)
    return scopeServiceBuildings((details?.buildings ?? []).map(toBuilding), selection.ids, selection.scope, { includeEmptyOfScopeType: true })
  }, [details, event, userName, cardId])
  const cards = useMemo<TerritoryCard[]>(() => (summaries ?? []).filter((row) => cardId == null || row.id === cardId)
    // This read-only map uses names and IDs; it never exposes detailed regular-visit points.
    .map((row) => ({ ...row, type: '전체', regularVisitPoints: [], assignedUsers: [], assignedLeader: null })), [summaries, cardId])
  const boundaries = useMemo(() => (details?.boundaries ?? []).filter((row) => cardId == null || row.card_id === cardId)
    .map(toCardBoundary).filter((row): row is CardBoundary => row != null), [details, cardId])
  const selected = buildings.find((building) => building.id === selectedBuildingId)
  function openMap(id: number | null) { setCardId(id); setSelectedBuildingId(0); setView('map') }
  return <>
    <div className="recipient-preview-tools">
      <strong>{cardServiceLabel(scope)}</strong>
      <span>{msg('카드 {n}개', { n: ids.length })}</span>
      <div className="recipient-preview-modes">
        <button type="button" title={msg('목록')} aria-label={msg('목록')} aria-pressed={view === 'list'} onClick={() => setView('list')}><PreviewIcon kind="list" /></button>
        <button type="button" title={msg('배정 구역 전체 지도')} aria-label={msg('배정 구역 전체 지도')} aria-pressed={view === 'map' && cardId == null} onClick={() => openMap(null)}><PreviewIcon kind="map" /></button>
      </div>
    </div>
    {error ? <p role="alert" className="recipient-preview-state">{msg('자료를 불러오지 못했습니다. 다시 시도해 주세요.')}</p>
      : view === 'list' ? <section className="recipient-preview-list" aria-busy={summaries == null}>
        {summaries == null ? <p>{msg('불러오는 중…')}</p> : summaries.map((card) => {
          const units = scope === '주택' ? card.houseUnits : scope === '상가' ? card.shopUnits : card.units
          const buildings = scope === '주택' ? card.houseBuildings : scope === '상가' ? card.shopBuildings : card.buildings
          const completed = scope === '주택' ? card.houseCompleted : scope === '상가' ? card.shopCompleted : card.completed
          const progress = units ? Math.round(completed / units * 100) : 100
          return <button type="button" key={card.id} onClick={() => openMap(card.id)}>
            <span><strong>{card.name}</strong><small>{msg('건물 {n}개', { n: buildings })} · {msg('{n}세대', { n: units })}</small></span>
            <span className="recipient-preview-progress">{progress}%<PreviewIcon kind="map" /></span>
          </button>
        })}
      </section> : <section className="recipient-preview-map" aria-busy={details == null}>
        {details == null ? <p className="recipient-preview-state" role="status">{msg('불러오는 중…')}</p> : <>
          <MapCanvas key={cardId ?? 'all'} buildings={buildings} cards={cards} cardBoundaries={boundaries}
            selectedBuildingId={selectedBuildingId} selectedCardId={cardId ?? '전체'} onSelectBuilding={setSelectedBuildingId}
            hideActionButton isMobile bottomPadding={selected ? 200 : 0} />
          {selected && <BuildingPreview building={selected} />}
        </>}
      </section>}
  </>
}

function BuildingPreview({ building }: { building: Building }) {
  return <aside className="recipient-preview-building">
    <strong>{building.name}</strong><span>{building.address}</span>
    <ul>{building.units.map((unit) => <li key={unit.id}><span>{unit.number}</span><span>{unit.status}</span></li>)}</ul>
  </aside>
}

/** Demo-only, read-only evaluation surface. Does not replace the service workflow. */
export function RecipientPreview({ userName }: { userName: string }) {
  const navigate = useNavigate()
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState(false)
  useEffect(() => {
    let api: ReturnType<typeof createRecipientPreview> | undefined
    let disposed = false
    void Promise.resolve().then(async () => {
      if (disposed) return
      api = createRecipientPreview(userName)
      const rows = await api.assignments()
      if (!disposed) setEvents(rows)
    }).catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true; api?.dispose() }
  }, [userName, attempt])
  const event = events?.find((row) => row.id === selectedId) ?? events?.[0]
  function refresh() { setEvents(null); setError(false); setAttempt((value) => value + 1) }
  return <main className="recipient-preview">
    <header>
      <button type="button" title={msg('뒤로')} aria-label={msg('뒤로')} onClick={() => navigate('/territory')}><PreviewIcon kind="back" /></button>
      <div><h1>{msg('나의 봉사')}</h1><small>{msg('데모 · 읽기 전용')}</small></div>
      <button type="button" title={msg('새로고침')} aria-label={msg('새로고침')} onClick={refresh}><PreviewIcon kind="refresh" /></button>
    </header>
    {events && events.length > 0 && <select aria-label={msg('봉사 일정')} value={event?.id} onChange={(e) => setSelectedId(Number(e.target.value))}>
      {events.map((row) => <option key={row.id} value={row.id}>{row.date} {row.time} · {row.title}</option>)}
    </select>}
    {error ? <p role="alert" className="recipient-preview-state">{msg('자료를 불러오지 못했습니다. 다시 시도해 주세요.')}</p>
      : !events ? <p role="status" className="recipient-preview-state">{msg('불러오는 중…')}</p>
        : event ? <AssignmentPreview key={`${attempt}:${event.id}`} event={event} userName={userName} />
          : <p className="recipient-preview-state">{msg('배정된 구역이 없습니다.')}</p>}
  </main>
}
