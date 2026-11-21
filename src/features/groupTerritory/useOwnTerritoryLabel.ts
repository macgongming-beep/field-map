import { msg } from '../../lib/msg'
import { useGroupTerritory } from './context'

export function useOwnTerritoryLabel() {
  const { groups, ownCode } = useGroupTerritory()
  const name = groups.find(group => group.code === ownCode)?.name
  return name ? msg('{group} 집단 구역', { group: name }) : msg('내 집단 구역')
}
