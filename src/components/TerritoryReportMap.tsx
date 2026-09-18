/* eslint-disable @typescript-eslint/no-explicit-any -- 네이버 지도 SDK는 공식 TS 타입이 없다. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TerritoryReportArea, TerritoryReportRegion } from '../types/territoryReport'

declare const naver: any

export function TerritoryReportMap({ regions, areas }: { regions: TerritoryReportRegion[]; areas: TerritoryReportArea[] }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [level, setLevel] = useState<'region' | 'area'>('region')
  const points = useMemo(() => level === 'region'
    ? regions.map(row => ({ key: row.region, label: row.region, total: row.total, centerLat: row.centerLat, centerLng: row.centerLng }))
    : areas.map(row => ({ key: `${row.region}-${row.area}`, label: row.area, total: row.total, centerLat: row.centerLat, centerLng: row.centerLng })),
  [areas, level, regions])

  useEffect(() => {
    const visible = points.filter(r => r.centerLat != null && r.centerLng != null)
    if (!rootRef.current || visible.length === 0 || typeof naver === 'undefined') return

    const map = new naver.maps.Map(rootRef.current, {
      center: new naver.maps.LatLng(visible[0].centerLat, visible[0].centerLng),
      zoom: level === 'region' ? 10 : 12,
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
  }, [level, points])

  const hasPoints = points.some(r => r.centerLat != null && r.centerLng != null)
  return (
    <div className="territory-report-map-shell">
      <div className="territory-report-map-level no-print">
        <button type="button" className={level === 'region' ? 'is-active' : ''} onClick={() => setLevel('region')}>구별</button>
        <button type="button" className={level === 'area' ? 'is-active' : ''} onClick={() => setLevel('area')}>동별</button>
      </div>
      {hasPoints
        ? <div ref={rootRef} className="territory-report-map" aria-label={`${level === 'region' ? '구별' : '동별'} 중국어 세대 분포 지도`} />
        : <div className="territory-report-map-empty">표시할 지도 좌표가 없습니다.</div>}
    </div>
  )
}
