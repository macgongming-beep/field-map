import { useState } from 'react'
import type { TerritoryCard } from '../../types'
import { msg } from '../../lib/msg'
import { showToast } from '../../lib/toast'
import { useGroupTerritory } from './context'
import { groupOwnsCard, territoryGroupNames } from './model'

export function GroupCardOwners({ card, readOnly = false }: { card: TerritoryCard; readOnly?: boolean }) {
  const territory = useGroupTerritory()
  const [saving, setSaving] = useState(false)
  const label = territoryGroupNames(card, territory.groups).join(' · ') || msg('미배정')
  if (readOnly || !territory.canManage) return <span>{label}</span>
  return <details className="territory-multi-select">
    <summary>{label}</summary>
    <div className="territory-multi-select-menu">
      {territory.groups.filter(group => group.active || groupOwnsCard(card, group.code)).map(group =>
        <label className="territory-multi-option" key={group.code}>
          <input type="checkbox" checked={groupOwnsCard(card, group.code)} disabled={saving || card.groupAssignmentRevision == null}
            onChange={async event => {
              const action = event.target.checked ? 'add' : 'remove'
              setSaving(true)
              try { await territory.save(group.code, [card], action) }
              catch (error) { showToast(error instanceof Error ? error.message : msg('집단 구역을 저장하지 못했습니다.'), 'error') }
              finally { setSaving(false) }
            }} />{group.name}
        </label>)}
    </div>
  </details>
}
