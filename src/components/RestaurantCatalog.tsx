import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Building, TerritoryCard, Unit } from '../types'
import { createRestaurantCatalog, type RestaurantCatalogItem, type RestaurantCatalogQuery } from '../lib/restaurantCatalog'
import { msg } from '../lib/msg'
import { translateKoreanAddress, type AppLanguage } from '../i18n'

type Props = {
  search: string; cards: TerritoryCard[]; language: AppLanguage; translatePlaceNames: boolean
  onSelect: (row: { building: Building; unit: Unit | null; key: string }) => void
  onAdd: () => void
}

export function RestaurantCatalog(props: Props) {
  const [region, setRegion] = useState('')
  const [area, setArea] = useState('')
  const regions = useMemo(() => [...new Set(props.cards.map(card => card.region || '기타'))].sort(), [props.cards])
  const areas = useMemo(() => [...new Set(props.cards.filter(card => (card.region || '기타') === region).map(card => card.area).filter(Boolean))].sort(), [props.cards, region])
  const query = useMemo(() => ({ search: props.search, region: region && region !== '*' ? region : null, area: area || null, all: region === '*' }), [props.search, region, area])
  const enabled = Boolean(props.search.trim() || region)
  return <>
    <div className="restaurant-catalog-filters">
      <select aria-label={msg('지역 선택')} value={region} onChange={event => { setRegion(event.target.value); setArea('') }}>
        <option value="">{msg('지역 선택')}</option>
        <option value="*">{msg('전체')}</option>
        {regions.map(value => <option key={value} value={value}>{translateKoreanAddress(value, props.language, props.translatePlaceNames)}</option>)}
      </select>
      <select aria-label={msg('동 선택')} value={area} disabled={!region || region === '*'} onChange={event => setArea(event.target.value)}>
        <option value="">{msg('전체 동')}</option>
        {areas.map(value => <option key={value} value={value}>{translateKoreanAddress(value, props.language, props.translatePlaceNames)}</option>)}
      </select>
    </div>
    {enabled && <CatalogResults key={JSON.stringify(query)} {...props} query={query} />}
  </>
}

function CatalogResults({ query, onSelect, onAdd, language, translatePlaceNames }: Props & { query: RestaurantCatalogQuery }) {
  const [api] = useState(createRestaurantCatalog)
  const [items, setItems] = useState<RestaurantCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectionError, setSelectionError] = useState(false)
  const active = useRef(false)
  const busy = useRef(false)
  const cursor = useRef<RestaurantCatalogItem | undefined>(undefined)
  const sentinel = useRef<HTMLDivElement>(null)
  const load = useCallback(async () => {
    if (!active.current || busy.current) return
    busy.current = true; setLoading(true); setError(false)
    try {
      const page = await api.page(query, cursor.current)
      if (!active.current) return
      setItems(previous => [...previous, ...page.items])
      cursor.current = page.items.at(-1) ?? cursor.current
      setMore(page.more)
    } catch {
      if (active.current) setError(true)
    } finally {
      busy.current = false
      if (active.current) setLoading(false)
    }
  }, [api, query])
  useEffect(() => {
    active.current = true
    const timer = setTimeout(() => { void load() }, query.search.trim() ? 350 : 0)
    return () => { active.current = false; clearTimeout(timer) }
  }, [load, query.search])
  useEffect(() => {
    const target = sentinel.current
    if (!target || !more || loading || error || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load()
    }, { root: target.closest('.restaurant-list-body'), rootMargin: '100px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [more, loading, error, load])
  async function select(item: RestaurantCatalogItem) {
    if (selecting) return
    setSelecting(true); setSelectionError(false)
    try {
      const detail = await api.detail(item)
      if (active.current) onSelect(detail)
    } catch {
      if (active.current) setSelectionError(true)
    } finally {
      if (active.current) setSelecting(false)
    }
  }
  return <>
    <ul className="restaurant-group-list" aria-busy={loading || selecting}>
      {items.map(item => <li key={`${item.building_id}:${item.unit_id}`}>
        <button type="button" className="restaurant-item" disabled={selecting} onClick={() => void select(item)}>
          <span className="restaurant-item-info">
            <strong className="restaurant-item-name">{item.name}</strong>
            <span className="restaurant-item-address">{translateKoreanAddress(item.address, language, translatePlaceNames)}</span>
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m9 5 7 7-7 7" /></svg>
        </button>
      </li>)}
    </ul>
    <div ref={sentinel} className="restaurant-catalog-footer">
      {(loading || selecting) && <p role="status">{msg('불러오는 중...')}</p>}
      {selectionError && <p role="alert">{msg('식당 정보를 불러오지 못했습니다. 다시 선택해 주세요.')}</p>}
      {error ? <button type="button" onClick={() => void load()}>{msg('다시 시도')}</button>
        : more && !loading ? <button type="button" onClick={() => void load()}>{msg('더 보기')}</button> : null}
      {!loading && !error && items.length === 0 && <p>{msg('검색 결과가 없습니다')}</p>}
      {!loading && !error && query.search.trim() && <button type="button" className="restaurant-add-request-btn" onClick={onAdd}>{msg('이 식당 추가 신청')}</button>}
    </div>
  </>
}
