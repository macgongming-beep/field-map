import { useMemo, useState } from 'react'
import type { TerritoryCard } from '../../types'
import { msg } from '../../lib/msg'
import { showToast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { useGroupTerritory } from './context'
import { GROUP_TERRITORY_BATCH_LIMIT, groupOwnsCard, territoryGroupNames } from './model'
import './groupTerritory.css'

export function GroupTerritoryAssignment({ cards }: { cards: TerritoryCard[] }) {
  const territory = useGroupTerritory()
  const [chosen, setChosen] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'assigned' | 'all'>('assigned')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const code = chosen || territory.groups.find(group => group.active)?.code || ''
  const group = territory.groups.find(item => item.code === code)
  const filtered = useMemo(() => cards.filter(card => (tab === 'all' || groupOwnsCard(card, code))
    && `${card.name} ${card.region} ${card.area}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [cards, code, query, tab])
  const targets = filtered.filter(card => checked.has(card.id))
  const canSave = territory.canManage && !!group && !saving && targets.length > 0
  async function save(action: 'add' | 'remove') {
    if (!canSave || (action === 'add' && !group?.active)) return
    const changes = targets.filter(card => groupOwnsCard(card, code) === (action === 'remove'))
    if (!changes.length) return
    if (changes.length > GROUP_TERRITORY_BATCH_LIMIT) {
      showToast(msg('한 번에 {n}개까지 선택해 주세요.', { n: GROUP_TERRITORY_BATCH_LIMIT }), 'error')
      return
    }
    if (action === 'remove' && !await confirmDialog({ message: msg('{group}의 구역 {n}개 배정을 해제할까요?', { group: group!.name, n: changes.length }) })) return
    setSaving(true)
    try {
      await territory.save(code, changes, action)
      setChecked(new Set())
      showToast(msg('집단 구역을 저장했습니다.'))
    } catch (error) { showToast(error instanceof Error ? error.message : msg('집단 구역을 저장하지 못했습니다.'), 'error') }
    finally { setSaving(false) }
  }
  return <section className="group-territory-assignment">
    <h1>{msg('집단 구역 배정')}</h1>
    <label className="group-territory-select">{msg('집단 선택')}
      <select value={code} disabled={saving} onChange={event => { setChosen(event.target.value); setChecked(new Set()) }}>
        {territory.groups.filter(item => item.active || cards.some(card => groupOwnsCard(card, item.code))).map(item =>
          <option key={item.code} value={item.code}>{item.name}{item.active ? '' : ` (${msg('비활성')})`}</option>)}
      </select>
    </label>
    <div className="group-territory-tabs" role="tablist" aria-label={msg('구역')}>
      <button role="tab" disabled={saving} aria-selected={tab === 'assigned'} onClick={() => { setTab('assigned'); setChecked(new Set()) }}>{msg('집단 구역')} {cards.filter(card => groupOwnsCard(card, code)).length}</button>
      <button role="tab" disabled={saving} aria-selected={tab === 'all'} onClick={() => { setTab('all'); setChecked(new Set()) }}>{msg('전체 구역')} {cards.length}</button>
    </div>
    <input type="search" aria-label={msg('구역 검색')} placeholder={msg('구역 검색')} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="group-territory-actions">
      <label><input type="checkbox" disabled={saving || !filtered.length} checked={filtered.length > 0 && targets.length === filtered.length}
        onChange={event => setChecked(event.target.checked ? new Set(filtered.map(card => card.id)) : new Set())} />{msg('전체 선택')}</label>
      <span>{msg('{n}개 선택', { n: targets.length })}</span>
      <button type="button" disabled={!canSave || !group?.active || !targets.some(card => !groupOwnsCard(card, code))} onClick={() => void save('add')}>+ {msg('추가')}</button>
      <button type="button" disabled={!canSave || !targets.some(card => groupOwnsCard(card, code))} onClick={() => void save('remove')}>{msg('배정 해제')}</button>
    </div>
    <ul className="group-territory-list">
      {filtered.map(card => <li key={card.id}><label>
        <input type="checkbox" checked={checked.has(card.id)} disabled={saving} onChange={event => setChecked(before => {
          const next = new Set(before); if (event.target.checked) next.add(card.id); else next.delete(card.id); return next
        })} />
        <span><strong>{card.name}</strong><small>{territoryGroupNames(card, territory.groups).join(' · ') || msg('미배정')}</small></span>
      </label></li>)}
    </ul>
    {!filtered.length && <p>{msg('구역이 없습니다')}</p>}
  </section>
}
