import { useMemo, useState } from 'react'
import type { ChineseTerritoryReportSnapshot, TerritoryReportArea } from '../types/territoryReport'
import { TerritoryReportMap } from './TerritoryReportMap'

const fmt = (value: number) => value.toLocaleString('ko-KR')
const dateLabel = (value: string) => value.replaceAll('-', '.')

export function TerritoryReportView({ snapshot, shared = false }: {
  snapshot: ChineseTerritoryReportSnapshot
  shared?: boolean
}) {
  const s = snapshot.summary
  const monthlyVisits = snapshot.monthlyVisits ?? []
  const cardRegions = snapshot.cardRegions ?? []
  const maxMonthlyHouseholds = Math.max(1, ...monthlyVisits.map(row => row.households))
  const regionNames = useMemo(() => Array.from(new Set(snapshot.areas.map(row => row.region))), [snapshot.areas])
  const [selectedAreaRegion, setSelectedAreaRegion] = useState(regionNames[0] ?? '')
  const visibleAreas = snapshot.areas.filter(row => row.region === selectedAreaRegion)
  const management = [
    ['최근 30일', snapshot.management.within30Days],
    ['최근 90일', snapshot.management.within30Days + snapshot.management.days31To90],
    ['최근 180일', snapshot.management.within30Days + snapshot.management.days31To90 + snapshot.management.days91To180],
    ['방문 기록 없음', snapshot.management.noHistory],
  ] as const

  const areaRows = (areas: TerritoryReportArea[]) => areas.map(row => (
    <tr key={`${row.region}-${row.area}`}>
      <td>{row.region}</td><td>{row.area}</td><td>{fmt(row.total)}</td>
      <td>{fmt(row.residential)}</td><td>{fmt(row.business)}</td>
      <td>{fmt(row.managed30d)}</td><td>{fmt(row.noHistory)}</td>
    </tr>
  ))

  return (
    <article className={`territory-report-view${shared ? ' is-shared' : ''}`}>
      <header className="territory-report-heading">
        <div>
          <p className="territory-report-eyebrow">{snapshot.congregationName || '경기용인중국어'} 구역 관리 현황</p>
          <h1>구역 관리 보고서</h1>
          <p>{dateLabel(snapshot.periodStart)} - {dateLabel(snapshot.periodEnd)}</p>
        </div>
        <div className="territory-report-generated">작성 {new Date(snapshot.generatedAt).toLocaleDateString('ko-KR')}</div>
      </header>

      {snapshot.note && <p className="territory-report-note">{snapshot.note}</p>}

      <section className="territory-report-kpis" aria-label="핵심 현황">
        <div><span>중국어 세대</span><strong>{fmt(s.total)}</strong></div>
        <div><span>주택 세대</span><strong>{fmt(s.residential)}</strong></div>
        <div><span>식당·상가</span><strong>{fmt(s.business)}</strong></div>
        <div><span>정기 방문</span><strong>{fmt(s.regularVisits)}</strong></div>
      </section>

      <section className="territory-report-section">
        <div className="territory-report-section-title">
          <div><h2>지역별 분포</h2><p>정확한 주소나 개별 위치는 표시하지 않습니다.</p></div>
        </div>
        <TerritoryReportMap regions={snapshot.regions} boundaries={snapshot.regionBoundaries ?? []} />
        <div className="territory-report-table-wrap">
          <table>
            <thead><tr><th>지역</th><th>전체</th><th>주택</th><th>식당·상가</th><th>최근 180일 방문 세대</th></tr></thead>
            <tbody>{snapshot.regions.map(row => (
              <tr key={row.region}>
                <td>{row.region}</td><td>{fmt(row.total)}</td><td>{fmt(row.residential)}</td>
                <td>{fmt(row.business)}</td><td>{fmt(row.managed180d ?? row.managed30d)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="territory-report-section">
        <div className="territory-report-section-title">
          <div><h2>최근 관리 상태</h2><p>선택한 종료일을 기준으로 마지막 유효 방문 기록을 집계합니다.</p></div>
        </div>
        <div className="territory-report-recency">
          {management.map(([label, count]) => (
            <div key={String(label)}><span>{label}</span><b>{fmt(Number(count))}</b></div>
          ))}
        </div>
        <p className="territory-report-recency-note">30·90·180일 수치는 각각 해당 기간 안에 방문한 세대의 누적 수입니다.</p>
        <div className="territory-report-monthly">
          <h3>월별 방문 세대</h3>
          <div className="territory-report-monthly-chart">
            {monthlyVisits.map(row => (
              <div key={row.month} className="territory-report-monthly-column">
                <b>{fmt(row.households)}</b>
                <div><span style={{ height: `${Math.max(4, row.households / maxMonthlyHouseholds * 100)}%` }} /></div>
                <small>{Number(row.month.slice(5))}월</small>
                <em>{fmt(row.visits)}회</em>
              </div>
            ))}
          </div>
          <p>같은 세대를 여러 번 방문한 경우 세대 수는 한 번만 계산하며, 아래 숫자는 전체 방문 기록 수입니다.</p>
        </div>
      </section>

      {snapshot.includeAreaDetails && snapshot.areas.length > 0 && <section className="territory-report-section page-break-before">
        <div className="territory-report-section-title">
          <div><h2>동별 중국어 세대</h2><p>지역별 관리 규모와 최근 관리 상태를 비교합니다.</p></div>
          <label className="territory-report-area-filter no-print">구 선택
            <select value={selectedAreaRegion} onChange={event => setSelectedAreaRegion(event.target.value)}>
              {regionNames.map(region => <option key={region} value={region}>{region}</option>)}
            </select>
          </label>
        </div>
        <div className="territory-report-table-wrap no-print">
          <table>
            <thead><tr><th>구</th><th>동</th><th>전체</th><th>주택</th><th>식당·상가</th><th>최근 30일 방문 세대</th><th>방문 기록 없음</th></tr></thead>
            <tbody>{areaRows(visibleAreas)}</tbody>
          </table>
        </div>
        <div className="territory-report-table-wrap print-only">
          <table>
            <thead><tr><th>구</th><th>동</th><th>전체</th><th>주택</th><th>식당·상가</th><th>최근 30일 방문 세대</th><th>방문 기록 없음</th></tr></thead>
            <tbody>{areaRows(snapshot.areas)}</tbody>
          </table>
        </div>
      </section>}

      <section className="territory-report-section territory-report-coverage">
        <h2>구역 관리 체계</h2>
        <div><span>전체 카드</span><b>{fmt(s.totalCards)}</b></div>
        <div><span>중국어 세대 포함 카드</span><b>{fmt(s.targetCards)}</b></div>
        <div className="territory-report-card-regions">
          <span>구별 전체 카드</span>
          <ul>{cardRegions.map(row => <li key={row.region}><span>{row.region}</span><b>{fmt(row.count)}</b></li>)}</ul>
        </div>
      </section>
    </article>
  )
}
