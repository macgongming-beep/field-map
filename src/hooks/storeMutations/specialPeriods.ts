import { ensureAffectedRows, reportMutationError, showToast, supabase } from './shared'
import { msg } from '../../lib/msg'

export function makeSpecialPeriodMutations(deps: { fetchAll: () => Promise<void> }) {
  const { fetchAll } = deps

  const createSpecialPeriod = async (input: {
    label: string
    startDate: string
    endDate: string
    color: string
    hasInvitation?: boolean
  }) => {
    if (!input.startDate || !input.endDate || input.endDate < input.startDate) {
      showToast(msg('종료일은 시작일보다 빠를 수 없습니다.'), 'error')
      return false
    }
    const result = await supabase.from('special_periods').insert({
      label: input.label.trim(),
      start_date: input.startDate,
      end_date: input.endDate,
      color: input.color,
      has_invitation: input.hasInvitation ?? false,
    }).select('id')
    if (result.error) {
      reportMutationError(msg('특별기간을 등록하지 못했습니다. special_periods 테이블이 있는지 확인해 주세요.'), result.error)
      return false
    }
    if (!ensureAffectedRows(result.data, msg('특별기간을 등록하지 못했습니다.'))) return false
    await fetchAll()
    showToast(msg('특별기간이 등록됐습니다'))
    return true
  }

  const updateSpecialPeriod = async (id: number, input: {
    label: string
    startDate: string
    endDate: string
    color: string
    hasInvitation?: boolean
  }) => {
    if (!input.startDate || !input.endDate || input.endDate < input.startDate) {
      showToast(msg('종료일은 시작일보다 빠를 수 없습니다.'), 'error')
      return false
    }
    const result = await supabase.from('special_periods').update({
      label: input.label.trim(),
      start_date: input.startDate,
      end_date: input.endDate,
      color: input.color,
      has_invitation: input.hasInvitation ?? false,
    }).eq('id', id).select('id')
    if (result.error) {
      reportMutationError(msg('특별기간을 수정하지 못했습니다.'), result.error)
      return false
    }
    if (!ensureAffectedRows(result.data, msg('특별기간을 수정하지 못했습니다.'))) return false
    await fetchAll()
    showToast(msg('특별기간이 수정됐습니다'))
    return true
  }

  const deleteSpecialPeriod = async (id: number) => {
    const result = await supabase.from('special_periods').delete().eq('id', id).select('id')
    if (result.error) {
      reportMutationError(msg('특별기간을 삭제하지 못했습니다.'), result.error)
      return
    }
    if (!ensureAffectedRows(result.data, msg('특별기간을 삭제하지 못했습니다.'))) return
    await fetchAll()
    showToast(msg('특별기간이 삭제됐습니다'))
  }

  return { createSpecialPeriod, updateSpecialPeriod, deleteSpecialPeriod }
}
