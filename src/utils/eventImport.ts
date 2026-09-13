export type ParsedEvent = {
  date: string
  time: string
  endTime: string
  title: string
  place: string
  leader: string
  memo: string
  allowApplications: boolean
  allowCartApplications: boolean
  cartCapacity: number | null
}

export function parsePastedEvents(pasteData: string): ParsedEvent[] {
  const results: ParsedEvent[] = []
  for (const line of pasteData.trim().split('\n')) {
    const cols = line.split('\t').map((column) => column.trim())
    if (cols.length < 4) continue

    const [dateRaw, timeRaw, endTimeRaw, titleRaw, placeRaw, leaderRaw, allowApplicationsRaw, , allowCartRaw, cartCapacityRaw] = cols
    if (dateRaw === '날짜') continue

    let date = dateRaw
    if (date.includes('/')) date = date.replace(/\//g, '-')
    if (date.length === 8 && !date.includes('-')) {
      date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    }

    const allowCartApplications = allowCartRaw?.toUpperCase() === 'O'
    results.push({
      date,
      time: timeRaw,
      endTime: endTimeRaw || '',
      title: titleRaw,
      place: placeRaw || '',
      leader: leaderRaw || '',
      memo: '',
      allowApplications: allowApplicationsRaw ? allowApplicationsRaw.toUpperCase() !== 'X' : true,
      allowCartApplications,
      cartCapacity: allowCartApplications ? Math.max(1, Number(cartCapacityRaw) || 1) : null,
    })
  }
  return results
}
