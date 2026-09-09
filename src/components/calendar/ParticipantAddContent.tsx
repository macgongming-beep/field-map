import { useMemo, useState } from 'react'
import { msg } from '../../lib/msg'
import { showToast } from '../../lib/toast'
import {
  eventParticipantNameKey,
  matchesRegisteredUserName,
  normalizeEventParticipantName,
  selectableEventParticipants,
  type EventParticipantUser,
} from '../../utils/eventParticipantUsers'

type ParticipantRole = '신청' | '게스트'

type Props = {
  users: EventParticipantUser[]
  existingNames: string[]
  onAdd: (name: string, role: ParticipantRole) => boolean | void | Promise<boolean | void>
  onAdded?: () => void
}

export function ParticipantAddContent({ users, existingNames, onAdd, onAdded }: Props) {
  const [query, setQuery] = useState('')
  const [guestName, setGuestName] = useState('')
  const [adding, setAdding] = useState(false)
  const existing = useMemo(() => new Set(existingNames.map(eventParticipantNameKey)), [existingNames])
  const candidates = useMemo(() => selectableEventParticipants(users)
    .filter((user) => !existing.has(eventParticipantNameKey(user.name)))
    .filter((user) => !query.trim() || user.name.includes(query.trim())), [existing, query, users])

  const add = async (name: string, role: ParticipantRole) => {
    if (adding) return
    setAdding(true)
    try {
      const result = await onAdd(name, role)
      if (result !== false) onAdded?.()
    } finally {
      setAdding(false)
    }
  }

  const addGuest = async () => {
    const name = normalizeEventParticipantName(guestName)
    if (!name) return
    if (existing.has(eventParticipantNameKey(name))) {
      showToast(msg('이미 이 일정에 있는 이름입니다.'), 'info')
      return
    }
    if (matchesRegisteredUserName(users, name)) {
      showToast(msg('등록된 계정과 같은 이름입니다. 계정을 활성화해서 추가해 주세요.'), 'info')
      return
    }
    await add(name, '게스트')
  }

  return (
    <div className="participant-add-content">
      <section className="participant-add-section">
        <strong className="participant-add-label">{msg('회중 봉사자')}</strong>
        <input
          className="participant-add-search"
          type="search"
          placeholder={msg('이름 검색...')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="participant-add-list">
          {candidates.map((user) => (
            <button
              className="participant-add-person"
              disabled={adding}
              key={user.id}
              onClick={() => void add(user.name, '신청')}
              type="button"
            >
              <span className="participant-add-avatar" aria-hidden>{user.name.slice(0, 1)}</span>
              <span>{user.name}</span>
            </button>
          ))}
          {candidates.length === 0 && (
            <span className="participant-add-empty">{msg('추가할 봉사자가 없습니다.')}</span>
          )}
        </div>
      </section>

      <section className="participant-add-section participant-add-guest">
        <div>
          <strong className="participant-add-label">{msg('계정 없는 게스트')}</strong>
          <span className="participant-add-help">{msg('이름을 직접 입력해 일정에 추가합니다.')}</span>
        </div>
        <div className="participant-add-guest-row">
          <input
            aria-label={msg('게스트 이름')}
            className="participant-add-search"
            placeholder={msg('게스트 이름')}
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void addGuest() }}
          />
          <button
            className="participant-add-guest-button"
            disabled={adding || !guestName.trim()}
            onClick={() => void addGuest()}
            type="button"
          >
            {msg('추가')}
          </button>
        </div>
      </section>
    </div>
  )
}
