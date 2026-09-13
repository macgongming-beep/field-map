import { getAuthToken } from './authToken'
import { supabase } from './supabase'

export async function resetDemoEnvironment(): Promise<{ ok: boolean; error?: string }> {
  const token = getAuthToken()
  if (!token) return { ok: false, error: '로그인 정보가 없습니다. 다시 로그인해 주세요.' }

  const { data, error } = await supabase.rpc('reset_demo_environment_tx', { p_token: token })
  if (error || !data) {
    console.error('[demo-reset] error:', error)
    return { ok: false, error: error?.message ?? '데모 데이터를 초기화하지 못했습니다.' }
  }
  return { ok: true }
}
