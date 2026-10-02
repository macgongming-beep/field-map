import { t } from '../../i18n'
import type { AppLanguage } from '../../i18n'

export function MeetingHeader({ title, language, onBack, disabled = false }: { title: string; language: AppLanguage; onBack: () => void; disabled?: boolean }) {
  return <header className="app-header app-header--mobile meeting-header">
    <div className="app-header__left">
      <button type="button" autoFocus className="app-header__back" disabled={disabled} aria-label={t(language, 'meeting.back')} onClick={onBack}>‹</button>
      <div className="app-header__title-group"><h1 className="app-header__title">{title}</h1></div>
    </div>
  </header>
}
