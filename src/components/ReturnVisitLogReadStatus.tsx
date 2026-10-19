import { msg } from '../lib/msg'

export function ReturnVisitLogReadStatus({ loading, error, reload }: {
  loading: boolean; error: boolean; reload: () => void
}) {
  if (loading) return <p role="status">{msg('불러오는 중...')}</p>
  if (error) return <div role="alert"><p>{msg('방문 기록을 불러오지 못했습니다.')}</p><button type="button" onClick={reload}>{msg('다시 시도')}</button></div>
  return null
}
