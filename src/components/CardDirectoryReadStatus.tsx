import { msg } from '../lib/msg'

export function CardDirectoryReadStatus({ loading, error, retry }: { loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <p role="status">{msg('불러오는 중...')}</p>
  if (error) return <button type="button" onClick={retry}>{msg('다시 시도')}</button>
  return null
}
