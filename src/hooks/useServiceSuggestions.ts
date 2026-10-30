import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ServiceSuggestion } from '../types'
import { toServiceSuggestion } from './storeTransforms'
import { readHomeServiceSuggestion } from './homeServiceSuggestion'
import { getAuthToken } from '../lib/authToken'

export function useServiceSuggestions(home = false) {
  const [suggestions, setSuggestions] = useState<ServiceSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)

  const fetchSuggestions = useCallback(async () => {
    const version = ++generation.current
    const token = getAuthToken()
    const current = () => version === generation.current && token === getAuthToken()
    try {
      if (home && (import.meta.env.VITE_HOME_SUGGESTION_BODY_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true') {
        const rows = await readHomeServiceSuggestion()
        if (current()) setSuggestions(rows.map(toServiceSuggestion))
        return
      }
      const { data, error } = await supabase
        .from('service_suggestions')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      if (data && current()) {
        setSuggestions(data.map(toServiceSuggestion))
      }
    } catch (err) {
      console.error('Failed to fetch service suggestions:', err)
    } finally {
      if (current()) setLoading(false)
    }
  }, [home])

  useEffect(() => {
    const requests = generation
    fetchSuggestions()
    return () => { ++requests.current }
  }, [fetchSuggestions])

  return { suggestions, loading, fetchSuggestions }
}
