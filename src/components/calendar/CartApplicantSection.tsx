import { useMemo, useState } from 'react'
import type { CalendarEvent } from '../../types'
import {
  eventParticipantNameKey,
  isSelectableEventParticipant,
  type EventParticipantUser,
} from '../../utils/eventParticipantUsers'
import { t, type AppLanguage } from '../../i18n'
import { confirmDialog } from '../../lib/confirm'
import { CART_APPLICATIONS_ENABLED } from '../../config/features'

type Props = {
  event: CalendarEvent
  language: AppLanguage
  currentVisitor: string
  canManage: boolean
  hideApplicantNames?: boolean
  users: EventParticipantUser[]
  onApply?: () => void
  onManage?: (userId: number, action: 'add' | 'remove') => Promise<boolean> | boolean
  onSetTeamLead?: (userId: number | null) => Promise<boolean> | boolean
}

export function CartApplicantSection({
  event,
  language,
  currentVisitor,
  canManage,
  hideApplicantNames = false,
  users,
  onApply,
  onManage,
  onSetTeamLead,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [menuUserId, setMenuUserId] = useState<number | null>(null)
  const cartApplicants = useMemo(() => event.cartApplicants ?? [], [event.cartApplicants])
  const currentVisitorKey = eventParticipantNameKey(currentVisitor)
  const currentApplied = cartApplicants.some((applicant) => eventParticipantNameKey(applicant.name) === currentVisitorKey)
  const full = event.cartCapacity != null && cartApplicants.length >= event.cartCapacity
  const currentUser = users.find((user) => eventParticipantNameKey(user.name) === currentVisitorKey)
  const currentUserApproved = currentUser?.cartServiceApproved === true && isSelectableEventParticipant(currentUser)
  const existingIds = useMemo(() => new Set(cartApplicants.map((item) => item.userId)), [cartApplicants])
  const normalNames = useMemo(() => new Set(event.applicants), [event.applicants])
  const candidates = useMemo(() => users
    .filter((user) => user.cartServiceApproved && user.isActive !== false && user.approvalStatus !== 'pending' && user.approvalStatus !== 'blocked')
    .filter((user) => !existingIds.has(user.id))
    .filter((user) => !query.trim() || user.name.includes(query.trim())), [existingIds, query, users])

  if (!CART_APPLICATIONS_ENABLED || (!event.allowCartApplications && cartApplicants.length === 0)) return null
  const canRevealApplicants = !hideApplicantNames || canManage

  return (
    <section className="cart-applicants-section">
      <div className="cart-applicants-head">
        <div className="cart-summary-group">
          <button
            aria-label={`${t(language, 'calendar.cartService')}${hideApplicantNames ? '' : ` ${cartApplicants.length}/${event.cartCapacity ?? 0}`}`}
            aria-expanded={canRevealApplicants ? expanded : undefined}
            className="cart-summary-toggle"
            disabled={!canRevealApplicants}
            onClick={() => {
              if (expanded) {
                setAdding(false)
                setMenuUserId(null)
              }
              setExpanded((value) => !value)
            }}
            type="button"
          >
            <span className="cart-summary-title">{t(language, 'calendar.cartService')}</span>
            {!hideApplicantNames && <span className="cart-summary-count">{cartApplicants.length}/{event.cartCapacity ?? 0}</span>}
            {canRevealApplicants && (
              <svg className={expanded ? 'expanded' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            )}
          </button>

        </div>
      </div>

      {expanded && (
        <div className="cart-applicants-toolbar">
          {event.allowCartApplications && onApply && (currentUserApproved || currentApplied) && (
            <button
              className={`cart-apply-button${currentApplied ? ' applied' : ''}`}
              disabled={full && !currentApplied}
              onClick={onApply}
              type="button"
            >
              {currentApplied
                ? t(language, 'calendar.cancelCartApplication')
                : full
                  ? t(language, 'calendar.cartFull')
                  : t(language, 'calendar.applyCart')}
            </button>
          )}

          {canManage && onManage && (
            <button
              className="cart-compact-action"
              onClick={() => setAdding((value) => !value)}
              type="button"
            >
              {adding ? t(language, 'common.cancel') : t(language, 'calendar.addPeople')}
            </button>
          )}
        </div>
      )}

      {expanded && adding && canManage && onManage && (
        <div className="cart-applicant-picker">
          <input
            aria-label={t(language, 'calendar.searchCartApplicant')}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(language, 'calendar.searchName')}
            type="search"
            value={query}
          />
          <div>
            {candidates.map((user) => (
              <button
                key={user.id}
                onClick={async () => {
                  if (normalNames.has(user.name)) {
                    const ok = await confirmDialog({
                      title: t(language, 'calendar.changeApplicationType'),
                      message: t(language, 'calendar.changeServiceToCartConfirm', { name: user.name }),
                      confirmLabel: t(language, 'calendar.change'),
                    })
                    if (!ok) return
                  }
                  if (await onManage(user.id, 'add')) setQuery('')
                }}
                type="button"
              >
                <span>{user.name.slice(0, 1)}</span>{user.name}
              </button>
            ))}
            {candidates.length === 0 && <small>{t(language, 'calendar.noApprovedCartApplicants')}</small>}
          </div>
        </div>
      )}

      {expanded && !hideApplicantNames && <div className="cart-applicant-list">
        {cartApplicants.map((applicant) => (
          <div className="cart-applicant-chip-wrap" key={applicant.userId}>
            <div className={`cart-applicant-chip${applicant.isTeamLead ? ' team-lead' : ''}`}>
              <span className="cart-applicant-avatar">{applicant.name.slice(0, 1)}</span>
              <strong>{applicant.name}</strong>
              {applicant.isTeamLead && <span className="cart-team-lead-label">{t(language, 'calendar.cartTeamLead')}</span>}
              {canManage && (onSetTeamLead || onManage) && (
                <button
                  aria-expanded={menuUserId === applicant.userId}
                  aria-label={`${applicant.name} ${t(language, 'common.more')}`}
                  className="cart-applicant-menu-button"
                  onClick={() => setMenuUserId((value) => value === applicant.userId ? null : applicant.userId)}
                  type="button"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
                  </svg>
                </button>
              )}
            </div>

            {menuUserId === applicant.userId && (
              <div className="cart-applicant-menu" role="menu">
                {onSetTeamLead && (
                  <button
                    onClick={async () => {
                      if (await onSetTeamLead(applicant.isTeamLead ? null : applicant.userId)) setMenuUserId(null)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {applicant.isTeamLead ? t(language, 'calendar.unsetTeamLead') : t(language, 'calendar.setTeamLead')}
                  </button>
                )}
                {onManage && (
                  <button
                    className="danger"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        message: t(language, 'calendar.removeCartApplicantConfirm', { name: applicant.name }),
                        confirmLabel: t(language, 'calendar.remove'),
                        danger: true,
                      })
                      if (ok && await onManage(applicant.userId, 'remove')) setMenuUserId(null)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {t(language, 'calendar.remove')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {cartApplicants.length === 0 && (
          <p>{t(language, 'calendar.noCartApplicants')}</p>
        )}
      </div>}
    </section>
  )
}
