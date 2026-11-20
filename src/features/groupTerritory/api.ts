import { supabase } from '../../lib/supabase'
import { getAuthToken } from '../../lib/authToken'
import { msg } from '../../lib/msg'
import type { TerritoryCard } from '../../types'
import { GROUP_TERRITORY_BATCH_LIMIT } from './model'

export async function saveTerritoryGroups(groupCode: string, cards: TerritoryCard[], action: 'add' | 'remove') {
  const token = getAuthToken()
  if (!token) throw new Error(msg('다시 로그인해 주세요.'))
  if (!cards.length || cards.some(card => card.groupAssignmentRevision == null)) throw new Error(msg('집단 구역을 다시 불러와 주세요.'))
  if (cards.length > GROUP_TERRITORY_BATCH_LIMIT) throw new Error(msg('한 번에 {n}개까지 선택해 주세요.', { n: GROUP_TERRITORY_BATCH_LIMIT }))
  const { data, error } = await supabase.rpc('set_territory_group_assignments_tx', {
    p_token: token, p_group_code: groupCode, p_card_ids: cards.map(card => card.id), p_action: action,
    p_expected: Object.fromEntries(cards.map(card => [card.id, card.groupAssignmentRevision])),
  })
  if (token !== getAuthToken()) throw new Error(msg('계정이 변경되었습니다. 저장 결과는 원래 계정에서 확인해 주세요.'))
  if (error) throw new Error(error.code === 'PT409' ? msg('집단 구역 배정이 변경되었습니다. 다시 확인해 주세요.') : msg('집단 구역을 저장하지 못했습니다.'))
  if (!data?.ok || data.count !== cards.length) throw new Error(msg('집단 구역을 저장하지 못했습니다.'))
}
