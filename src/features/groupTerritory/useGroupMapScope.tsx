import { useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Building, CardBoundary, Role, TerritoryCard } from '../../types'
import type { MapViewportMemory } from '../../components/MapCanvas'
import { useGroupTerritory } from './context'
import { groupOwnsCard } from './model'
import { MapFilterButton } from './MapFilterButton'
import { GroupScopeSelect } from './GroupScopeSelect'
import { msg } from '../../lib/msg'
import { useOwnTerritoryLabel } from './useOwnTerritoryLabel'

export function useGroupMapScope(source: { cards: TerritoryCard[]; buildings: Building[]; cardBoundaries: CardBoundary[] }, role: Role, restricted = false) {
  const context = useGroupTerritory()
  const [params, setParams] = useSearchParams()
  const ownLabel = useOwnTerritoryLabel()
  const available = context.enabled && role !== 'user' && (role !== 'leader' || !!context.ownCode) && !restricted && !params.has('assignmentMap') && !params.has('addr') && !params.has('informalId')
  const code = role === 'leader' ? context.ownCode : params.get('groupCode') ?? context.ownCode ?? context.groups.find(group => group.active)?.code ?? null
  const on = params.has('groupCode') && params.get('groupView') !== 'all'
  const changeActive = (active: boolean) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      next.set('groupView', active ? 'mine' : 'all')
      if (code) next.set('groupCode', code)
      return next
    }, { replace: true })
  }
  const active = available && on
  const cards = useMemo(() => active ? source.cards.filter(card => groupOwnsCard(card, code)) : source.cards, [source.cards, active, code])
  const ids = useMemo(() => new Set(cards.map(card => card.id)), [cards])
  const buildings = useMemo(() => active ? source.buildings.filter(building => ids.has(building.cardId)) : source.buildings, [source.buildings, active, ids])
  const cardBoundaries = useMemo(() => active ? source.cardBoundaries.filter(boundary => ids.has(boundary.cardId)) : source.cardBoundaries, [source.cardBoundaries, active, ids])
  const viewport = useRef<MapViewportMemory['current']>(null)
  const controls = available ? <div className="group-map-controls">
    <MapFilterButton label={msg('집단 구역만 보기')} pressed={active} onClick={() => changeActive(!active)}>
      {/* Lucide land-plot, ISC licensed. */}
      <svg viewBox="0 0 24 24" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 8 6-3-6-3v10" />
        <path d="m8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12" />
        <path d="m6.49 12.85 11.02 6.3" />
        <path d="M17.51 12.85 6.5 19.15" />
      </svg>
    </MapFilterButton>
  </div> : null
  const selector = active && role === 'leader' ? <h1 className="leader-group-map-title">{ownLabel}</h1> : active ? <div className="group-map-selector"><GroupScopeSelect value={code ?? 'all'} onChange={value => {
    if (value === 'all') changeActive(false)
    else setParams(previous => { const next = new URLSearchParams(previous); next.set('groupCode', value); return next }, { replace: true })
  }} /></div> : null
  const revealSearchCard = (card: TerritoryCard) => {
    // Search may reveal another authorized card without changing the remembered group.
    const outside = active && !groupOwnsCard(card, code)
    if (outside) changeActive(false)
    return outside
  }
  return { cards, buildings, cardBoundaries, controls, selector, active, code, revealSearchCard, viewportMemory: available ? viewport : undefined }
}
