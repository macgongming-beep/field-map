// Korean-only disposable UI prototype. No store, auth, persistence, or mutation APIs.
import { useState } from 'react'
import { msg } from '../../lib/msg'
import { MapCanvas } from '../MapCanvas'
import { InformalKindIcon } from '../InformalKindIcon'
import {
  initialTeams,
  previewCards,
  previewBoundaries,
  previewInformal,
  previewRestaurants,
  scopedPreviewBuildings,
} from './previewData'
import type { UnitUsageFilter } from '../../utils/unitUsage'
import '../../App.css'
import './ServiceScopePreview.css'

const toggle = (items: number[], id: number) =>
  items.includes(id) ? items.filter((n) => n !== id) : [...items, id]

const serviceLabel = (scope: UnitUsageFilter) =>
  scope === '전체' ? msg('주택·상가 전체') : scope === '주택' ? msg('주택 봉사') : msg('상가 봉사')

export default function ServiceScopePreview() {
  const [teams, setTeams] = useState(initialTeams)
  const [teamId, setTeamId] = useState(initialTeams[0].id)
  const [page, setPage] = useState<'assign' | 'mine'>('assign')
  const [tab, setTab] = useState('카드')
  const [view, setView] = useState<'map' | 'list'>('map')
  const [region, setRegion] = useState('전체')
  const [query, setQuery] = useState('')
  const [person, setPerson] = useState('예시 한지우')
  const [viewer, setViewer] = useState(initialTeams[0].members[0])
  const [restaurants, setRestaurants] = useState<Record<string, number[]>>({
    '예시 한지우': [previewRestaurants[0].id],
  })
  const [mapTarget, setMapTarget] = useState<'cards' | number | null>(null)
  const [buildingId, setBuildingId] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const team = teams.find((t) => t.id === teamId)!
  const mine = teams.find((t) => t.members.includes(viewer))!
  const members = teams.flatMap((t) => t.members)
  const setCards = (id: number) =>
    setTeams((ts) =>
      ts.map((t) =>
        t.id === teamId ? { ...t, cardIds: toggle(t.cardIds, id) } : t,
      ),
    )
  const setScope = (scope: UnitUsageFilter) => {
    const valid = scopedPreviewBuildings(team.cardIds, scope).map(
      (b) => b.cardId,
    )
    const removed = team.cardIds.filter((id) => !valid.includes(id))
    if (
      removed.length &&
      !window.confirm(
        `해당 세대가 없는 카드 ${removed.length}개를 선택에서 제외할까요?`,
      )
    )
      return
    setTeams((ts) =>
      ts.map((t) => (t.id === teamId ? { ...t, scope, cardIds: valid } : t)),
    )
  }
  const visible = scopedPreviewBuildings(
    previewCards
      .filter(
        (c) =>
          (region === '전체' || c.region === region) && c.name.includes(query),
      )
      .map((c) => c.id),
    team.scope,
  )
  const myBuildings = scopedPreviewBuildings(mine.cardIds, mine.scope)
  const summary = (t: typeof team) =>
    [
      t.cardIds.length ? `${serviceLabel(t.scope)} · 카드 ${t.cardIds.length}개` : '',
      t.informalIds.length ? `비공식 ${t.informalIds.length}개` : '',
    ]
      .filter(Boolean)
      .join(' + ') || '팀 배정 없음'
  const openMyMap = (target: 'cards' | number) => {
    setMapTarget(target)
    setBuildingId(0)
    setExpanded(false)
  }
  const informal =
    typeof mapTarget === 'number'
      ? previewInformal.find((a) => a.id === mapTarget)
      : null
  const picked = myBuildings.find((b) => b.id === buildingId)

  return (
    <main className="scope-preview">
      <aside className="sp-demo">
        {msg('데모 미리보기 · 가상 자료 · 실제 저장 없음')}
        <a href="/">{msg('데모 홈')}</a>
      </aside>
      <nav className="sp-pages" aria-label={msg('미리보기 화면')}>
        <button
          aria-pressed={page === 'assign'}
          onClick={() => {
            setPage('assign')
            setMapTarget(null)
          }}
        >
          {msg('구역 배분')}
        </button>
        <button
          aria-pressed={page === 'mine'}
          onClick={() => {
            setPage('mine')
            setViewer(team.members[0])
            setMapTarget(null)
          }}
        >
          {msg('나의 봉사')}
        </button>
      </nav>
      {page === 'assign' ? (
        <>
          <header>
            <h1>{msg('구역 배분')}</h1>
            <p>
              {tab === '식당'
                ? `개인 배정 · ${person}`
                : `${team.name} · ${team.members.join(' · ')}`}
            </p>
          </header>
          {tab !== '식당' && (
            <div className="sp-teams">
              {teams.map((t) => (
                <button
                  key={t.id}
                  aria-pressed={t.id === teamId}
                  onClick={() => setTeamId(t.id)}
                >
                  <strong>
                    {t.name} · {t.members.length}
                    {msg('명')}
                  </strong>
                  <small>{summary(t)}</small>
                </button>
              ))}
            </div>
          )}
          <div className="sp-nav">
            <div className="sp-segment">
              {['카드', '비공식', '식당'].map((label) => (
                <button
                  key={label}
                  aria-pressed={tab === label}
                  onClick={() => {
                    setTab(label)
                    setQuery('')
                  }}
                >
                  {label}
                  {label === '카드'
                    ? ` ${team.cardIds.length}`
                    : label === '비공식'
                      ? ` ${team.informalIds.length}`
                      : ''}
                </button>
              ))}
            </div>
            {tab === '카드' && (
              <div className="sp-segment">
                <button
                  aria-label={msg('지도')}
                  title={msg('지도')}
                  aria-pressed={view === 'map'}
                  onClick={() => setView('map')}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                  >
                    <path d="M2 5l6-3 8 3 6-3v17l-6 3-8-3-6 3zM8 2v17M16 5v17" />
                  </svg>
                </button>
                <button
                  aria-label={msg('목록')}
                  title={msg('목록')}
                  aria-pressed={view === 'list'}
                  onClick={() => setView('list')}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M3 6h18M3 12h18M3 18h18" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {tab === '카드' && (
            <>
              <div className="sp-scope">
                <div className="sp-segment">
                  {(['전체', '주택', '상가'] as const).map((s) => (
                    <button
                      key={s}
                      aria-pressed={team.scope === s}
                      onClick={() => setScope(s)}
                    >
                      {serviceLabel(s)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sp-regions">
                {['전체', '테스트구', '연습구'].map((r) => (
                  <button
                    key={r}
                    aria-pressed={region === r}
                    onClick={() => setRegion(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {view === 'map' && (
                <div className="sp-map">
                  <MapCanvas
                    buildings={visible}
                    cards={previewCards.filter((c) =>
                      visible.some((b) => b.cardId === c.id),
                    )}
                    cardBoundaries={previewBoundaries.filter((b) =>
                      visible.some((v) => v.cardId === b.cardId),
                    )}
                    selectedCardId="전체"
                    selectedBuildingId={0}
                    onSelectBuilding={(id) => setCards(id)}
                    onSelectCardBoundary={setCards}
                    highlightedCardIds={new Set(team.cardIds)}
                    hideActionButton
                    compact
                  />
                </div>
              )}
              <input
                aria-label={msg('카드 검색')}
                placeholder={msg('카드 검색')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="sp-rows">
                {visible.map((b) => (
                  <label className="sp-row" key={b.id}>
                    <input
                      type="checkbox"
                      checked={team.cardIds.includes(b.cardId)}
                      onChange={() => setCards(b.cardId)}
                    />
                    <span>
                      <strong>{b.name}</strong>
                      <small>
                        {previewCards.find((c) => c.id === b.cardId)?.region} ·{' '}
                        {team.scope} {b.units.length}
                        {msg('세대')}
                      </small>
                    </span>
                  </label>
                ))}
                {!visible.length && (
                  <p>{msg('조건에 맞는 카드가 없습니다.')}</p>
                )}
              </div>
            </>
          )}
          {tab === '비공식' && (
            <div className="sp-rows">
              {previewInformal.map((a) => (
                <label className="sp-row" key={a.id}>
                  <input
                    type="checkbox"
                    checked={team.informalIds.includes(a.id)}
                    onChange={() =>
                      setTeams((ts) =>
                        ts.map((t) =>
                          t.id === teamId
                            ? { ...t, informalIds: toggle(t.informalIds, a.id) }
                            : t,
                        ),
                      )
                    }
                  />
                  <InformalKindIcon kind="비공식구역" size={22} />
                  <span>
                    <strong>{a.name}</strong>
                    <small>{msg('거점 1 · 대화장소 1')}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          {tab === '식당' && (
            <>
              <label className="sp-person">
                {msg('담당자')}
                <select
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                >
                  {members.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <div className="sp-rows">
                {previewRestaurants.map((r) => (
                  <label className="sp-row" key={r.id}>
                    <input
                      type="checkbox"
                      checked={(restaurants[person] ?? []).includes(r.id)}
                      onChange={() =>
                        setRestaurants((prev) => ({
                          ...prev,
                          [person]: toggle(prev[person] ?? [], r.id),
                        }))
                      }
                    />
                    <span>
                      <strong>{r.name}</strong>
                      <small>{r.address}</small>
                      <small>
                        {Object.entries(restaurants)
                          .filter(([, ids]) => ids.includes(r.id))
                          .map(([m]) => m)
                          .join(' · ')}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          <footer>
            <button
              className="sp-primary"
              onClick={() => {
                setViewer(tab === '식당' ? person : team.members[0])
                setPage('mine')
                setMapTarget(null)
              }}
            >
              {msg('나의 봉사 미리보기 →')}
            </button>
          </footer>
        </>
      ) : (
        <>
          <header>
            <h1>{msg('나의 봉사')}</h1>
            <p>{msg('오늘 15:00–17:00 · 예시 일정')}</p>
          </header>
          <label className="sp-person">
            {msg('봉사자')}
            <select
              aria-label={msg('봉사자')}
              value={viewer}
              onChange={(e) => {
                setViewer(e.target.value)
                setMapTarget(null)
              }}
            >
              {members.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <div className="sp-team-summary">
            <strong>{mine.name}</strong>
            <p>{mine.members.join(' · ')}</p>
          </div>
          {mapTarget !== null ? (
            <section>
              <button className="sp-back" onClick={() => setMapTarget(null)}>
                {msg('← 배정 목록')}
              </button>
              <h2>
                {informal
                  ? informal.name
                  : `${serviceLabel(mine.scope)} · 카드 ${mine.cardIds.length}개`}
              </h2>
              <div className="sp-map sp-service-map">
                <MapCanvas
                  buildings={informal ? [] : myBuildings}
                  cards={
                    informal
                      ? []
                      : previewCards.filter((c) => mine.cardIds.includes(c.id))
                  }
                  cardBoundaries={
                    informal
                      ? []
                      : previewBoundaries.filter((c) =>
                          mine.cardIds.includes(c.cardId),
                        )
                  }
                  selectedCardId="전체"
                  selectedBuildingId={buildingId}
                  onSelectBuilding={(id) => {
                    setBuildingId(id)
                    setExpanded(false)
                  }}
                  hideActionButton
                  compact
                  informalPlaces={
                    informal
                      ? [
                          { ...informal, kind: '비공식구역' },
                          {
                            id: 101,
                            name: '연습 거점',
                            lat: informal.lat + 0.0003,
                            lng: informal.lng,
                            kind: '거점',
                          },
                          {
                            id: 102,
                            name: '연습 대화장소',
                            lat: informal.lat,
                            lng: informal.lng + 0.0003,
                            kind: '대화장소',
                          },
                        ]
                      : []
                  }
                  focusPoint={informal ? { ...informal, zoom: 17 } : undefined}
                />
              </div>
              {!informal && (
                <div className="sp-sheet">
                  <button onClick={() => setExpanded(!expanded)}>
                    {picked
                      ? `${picked.name} · ${picked.units.length}세대`
                      : `건물 ${myBuildings.length}개 · ${myBuildings.reduce((n, b) => n + b.units.length, 0)}세대`}{' '}
                    <span>{expanded ? '⌄' : '⌃'}</span>
                  </button>
                  {expanded &&
                    (picked ? [picked] : myBuildings).map((b) => (
                      <div key={b.id}>
                        <strong>{b.name}</strong>
                        {b.units.map((u) => (
                          <p key={u.id}>
                            {u.number} · {u.status}
                          </p>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </section>
          ) : (
            <>
              {mine.cardIds.length > 0 && (
                <section className="sp-work">
                  <h2>
                    {serviceLabel(mine.scope)}{' '}
                    <small>
                      {msg('카드')}{' '}
                      {mine.cardIds.length}
                      {msg('개')}
                    </small>
                  </h2>
                  <p>
                    {myBuildings.reduce((n, b) => n + b.units.length, 0)}
                    {msg('세대 ·')}{' '}
                    {previewCards
                      .filter((c) => mine.cardIds.includes(c.id))
                      .map((c) => c.name)
                      .join(' / ')}
                  </p>
                  <button
                    className="sp-primary"
                    onClick={() => openMyMap('cards')}
                  >
                    {msg('배정 구역 지도 보기')}
                  </button>
                </section>
              )}
              {mine.informalIds.length > 0 && (
                <section className="sp-work">
                  <h2>
                    {msg('비공식 증거')}{' '}
                    <small>
                      {msg('카드')}{' '}
                      {mine.informalIds.length}
                      {msg('개')}
                    </small>
                  </h2>
                  {previewInformal
                    .filter((a) => mine.informalIds.includes(a.id))
                    .map((a) => (
                      <div className="sp-row" key={a.id}>
                        <InformalKindIcon kind="비공식구역" size={22} />
                        <strong>{a.name}</strong>
                        <button onClick={() => openMyMap(a.id)}>
                          {msg('열기')}
                        </button>
                      </div>
                    ))}
                </section>
              )}
              {(restaurants[viewer] ?? []).length > 0 && (
                <section className="sp-work">
                  <h2>
                    {msg('내 식당 배정')}{' '}
                    <small>
                      {restaurants[viewer].length}
                      {msg('곳')}
                    </small>
                  </h2>
                  {previewRestaurants
                    .filter((r) => restaurants[viewer].includes(r.id))
                    .map((r) => (
                      <div className="sp-row" key={r.id}>
                        <span>
                          <strong>{r.name}</strong>
                          <small>{r.address}</small>
                        </span>
                      </div>
                    ))}
                </section>
              )}
              {!mine.cardIds.length &&
                !mine.informalIds.length &&
                !(restaurants[viewer] ?? []).length && (
                  <p>{msg('배정된 봉사가 없습니다.')}</p>
                )}
            </>
          )}
        </>
      )}
    </main>
  )
}
