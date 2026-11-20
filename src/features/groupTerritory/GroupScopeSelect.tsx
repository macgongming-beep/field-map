import { msg } from '../../lib/msg'
import { useGroupTerritory } from './context'

export function GroupScopeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { groups } = useGroupTerritory()
  return <label className="group-territory-scope">
    <select aria-label={msg('집단 구역 보기')} value={value} onChange={event => onChange(event.target.value)}>
      <option value="all">{msg('전체 구역')}</option>
      {groups.filter(group => group.active || group.code === value).map(group => <option key={group.code} value={group.code}>{group.name}</option>)}
    </select>
  </label>
}
