import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ServiceSuggestion } from '../types'
import { toServiceSuggestion } from './storeTransforms'
import { readHomeServiceSuggestion } from './homeServiceSuggestion'

export function useServiceSuggestions(home = false) {
  const [suggestions, setSuggestions] = useState<ServiceSuggestion[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSuggestions = useCallback(async () => {
    try {
      if (home && import.meta.env.VITE_DEMO_MODE === 'true') {
        setSuggestions((await readHomeServiceSuggestion()).map(toServiceSuggestion))
        return
      }
      const { data, error } = await supabase
        .from('service_suggestions')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      if (data) {
        setSuggestions(data.map(toServiceSuggestion))
      }
    } catch (err) {
      console.error('Failed to fetch service suggestions:', err)
    } finally {
      setLoading(false)
    }
  }, [home])

  useEffect(() => {
    fetchSuggestions()
  }, [fetchSuggestions])

  return { suggestions, loading, fetchSuggestions }
}
