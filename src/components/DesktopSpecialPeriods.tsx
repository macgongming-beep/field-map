import type { SpecialPeriod } from '../types'
import { SpecialPeriodSettings } from './SpecialPeriodSettings'
import { msg } from '../lib/msg'

export function DesktopSpecialPeriods({
  specialPeriods,
  onCreateSpecialPeriod,
  onUpdateSpecialPeriod,
  onDeleteSpecialPeriod,
}: {
  specialPeriods: SpecialPeriod[]
  onCreateSpecialPeriod: (input: { label: string; startDate: string; endDate: string; color: string; hasInvitation?: boolean }) => Promise<boolean | void> | boolean | void
  onUpdateSpecialPeriod: (id: number, input: { label: string; startDate: string; endDate: string; color: string; hasInvitation?: boolean }) => Promise<boolean | void> | boolean | void
  onDeleteSpecialPeriod: (id: number) => Promise<void> | void
}) {
  

  return (
    <div className="desk-settings-subpage" style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', marginBottom: 24 }}>{msg('특별 봉사 시즌 관리')}</h2>
      <div className="desktop-profile-stack" style={{ display: 'grid', gap: 24 }}>
        <SpecialPeriodSettings
          isAdmin
          specialPeriods={specialPeriods}
          onCreateSpecialPeriod={onCreateSpecialPeriod}
          onUpdateSpecialPeriod={onUpdateSpecialPeriod}
          onDeleteSpecialPeriod={onDeleteSpecialPeriod}
        />
      </div>
    </div>
  )
}
