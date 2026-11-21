import { msg } from '../../lib/msg'
import { useGroupTerritory } from './context'
import { useOwnTerritoryLabel } from './useOwnTerritoryLabel'

export function LeaderTerritoryScope({ value, onChange }: { value: 'mine' | 'all'; onChange: (value: 'mine' | 'all') => void }) {
  const { ownCode } = useGroupTerritory()
  const label = useOwnTerritoryLabel()
  return <div className="leader-territory-scope" role="group" aria-label={msg('집단 구역 보기')}>
    <button type="button" aria-pressed={value === 'mine'} disabled={!ownCode} onClick={() => onChange('mine')}>{label}</button>
    <button type="button" aria-pressed={value === 'all'} onClick={() => onChange('all')}>{msg('전체 구역')}</button>
  </div>
}
