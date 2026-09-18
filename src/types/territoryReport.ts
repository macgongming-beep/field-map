export type TerritoryReportSummary = {
  total: number
  residential: number
  business: number
  regularVisits: number
  totalCards: number
  targetCards: number
  assignedCards: number
  unassignedCards: number
  consistencyWarnings: number
}

export type TerritoryReportRegion = {
  region: string
  total: number
  residential: number
  business: number
  managed30d: number
  regularVisits: number
  centerLat: number | null
  centerLng: number | null
}

export type TerritoryReportArea = {
  region: string
  area: string
  total: number
  residential: number
  business: number
  managed30d: number
  noHistory: number
  centerLat: number | null
  centerLng: number | null
}

export type ChineseTerritoryReportSnapshot = {
  schemaVersion: number
  congregationName: string
  generatedAt: string
  periodStart: string
  periodEnd: string
  note: string
  summary: TerritoryReportSummary
  management: {
    within30Days: number
    days31To90: number
    days91To180: number
    over180Days: number
    noHistory: number
  }
  statuses: Array<{ status: string; count: number }>
  monthlyVisits: Array<{ month: string; households: number; visits: number }>
  cardRegions: Array<{ region: string; count: number }>
  regions: TerritoryReportRegion[]
  areas: TerritoryReportArea[]
}

export type TerritoryReportShare = {
  id: string
  expiresAt: string
  revokedAt: string | null
  pinRequired: boolean
  viewCount: number
  lastViewedAt: string | null
  createdAt: string
  periodStart: string
  periodEnd: string
}
