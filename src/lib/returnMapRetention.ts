export function returnMapRetentionEnabled(
  flag = import.meta.env.VITE_RETURN_MAP_RETENTION_ENABLED,
  demo = import.meta.env.VITE_DEMO_MODE,
): boolean {
  return (flag ?? demo) === 'true'
}

/** Only a linked, focused return-visit map may retain a partial store. */
export function isFocusedReturnVisitMap(path: string, search: string): boolean {
  if (path !== '/map') return false
  const params = new URLSearchParams(search)
  const positiveId = (value: string | null) => value !== null && /^\d+$/.test(value)
    && Number.isSafeInteger(Number(value)) && Number(value) > 0
  if (params.getAll('scope').length !== 1 || params.get('scope') !== 'regularVisits'
    || params.getAll('returnVisitId').length !== 1 || !positiveId(params.get('returnVisitId'))) return false
  if (params.getAll('buildingId').length !== 1 || !positiveId(params.get('buildingId'))) return false
  return !['addr', 'assignmentMap', 'assignmentCard', 'cardId', 'cardIds', 'informalId', 'openEvent', 'openChat']
    .some(key => params.has(key))
}
