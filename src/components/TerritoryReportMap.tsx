/* eslint-disable @typescript-eslint/no-explicit-any -- 네이버 지도 SDK는 공식 TS 타입이 없다. */
import { useEffect, useMemo, useRef } from 'react'
import type { TerritoryReportRegion } from '../types/territoryReport'

declare const naver: any

export function TerritoryReportMap({ regions }: { regions: TerritoryReportRegion[] }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const points = useMemo(() => regions.map(row => ({
    key: row.region,
    label: row.region,
    total: row.total,
    centerLat: row.centerLat,
    centerLng: row.centerLng,
  })), [regions])

  useEffect(() => {
    const visible = points.filter(r => r.centerLat != null && r.centerLng != null)
    if (!rootRef.current || visible.length === 0 || typeof naver === 'undefined') return

    const map = new naver.maps.Map(rootRef.current, {
      center: new naver.maps.LatLng(visible[0].centerLat, visible[0].centerLng),
      zoom: 10,
      minZoom: 8,
      scaleControl: false,
      logoControlOptions: { position: naver.maps.Position.BOTTOM_LEFT },
    })
    const bounds = new naver.maps.LatLngBounds()
    visible.forEach(region => {
      const position = new naver.maps.LatLng(region.centerLat, region.centerLng)
      bounds.extend(position)
      new naver.maps.Marker({
        map,
        position,
        icon: {
          content: `<div class="territory-report-map-marker"><b>${region.label}</b><span>${region.total.toLocaleString()}개</span></div>`,
          anchor: new naver.maps.Point(50, 24),
        },
      })
    })
    if (visible.length > 1) map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 })
    return () => map.destroy()
  }, [points])

  const hasPoints = points.some(r => r.centerLat != null && r.centerLng != null)
  return (
    <div className="territory-report-map-shell">
      {hasPoints
        ? <div ref={rootRef} className="territory-report-map" aria-label="구별 중국어 세대 분포 지도" />
        : <div className="territory-report-map-empty">표시할 지도 좌표가 없습니다.</div>}
    </div>
  )
}
