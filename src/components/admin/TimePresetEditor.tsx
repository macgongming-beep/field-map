import { t, type AppLanguage } from '../../i18n'
import { msg } from '../../lib/msg'
import { TIME_PRESETS_MAX, type TimePreset } from '../../lib/timePresets'

function pad2(n: number) { return String(n).padStart(2, '0') }

export function TimePresetEditor({ language,
  presets,
  onChange,
}: {
  presets: TimePreset[]
  onChange: (presets: TimePreset[]) => void
; language: AppLanguage }) {
  const updatePreset = (index: number, patch: Partial<TimePreset>) => {
    onChange(presets.map((preset, i) => i === index ? { ...preset, ...patch } : preset))
  }

  const addPreset = () => {
    if (presets.length >= TIME_PRESETS_MAX) return
    const baseHour = 10 + presets.length * 2
    const time = `${pad2(Math.min(baseHour, 21))}:00`
    onChange([
      ...presets,
      {
        label: t(language, 'calendar.timePresetLabel', { count: presets.length + 1 }),
        time,
        durationMinutes: 120,
        title: t(language, 'calendar.defaultEventTitle'),
      },
    ])
  }

  const removePreset = (index: number) => {
    if (presets.length <= 1) return
    onChange(presets.filter((_, i) => i !== index))
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--bg)',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 750, color: 'var(--ink)' }}>{t(language, 'calendar.editTimeSettings')}</span>
        <button
          type="button"
          disabled={presets.length >= TIME_PRESETS_MAX}
          onClick={addPreset}
          style={{
            minHeight: 0,
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: presets.length >= TIME_PRESETS_MAX ? 'var(--surface)' : '#fff',
            color: presets.length >= TIME_PRESETS_MAX ? 'var(--muted-2)' : 'var(--text)',
            cursor: presets.length >= TIME_PRESETS_MAX ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 750,
            padding: '6px 9px',
          }}
        >
          {t(language, 'common.add')}
        </button>
      </div>

      {presets.map((preset, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            minWidth: 0,
          }}
        >
          <div
            className="time-preset-row"
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 0.7fr) 24px',
              gap: 5,
              alignItems: 'center',
              minWidth: 0,
            }}
          >
            <MiniInput
              ariaLabel={t(language, 'calendar.timePresetLabelField')}
              value={preset.label}
              onChange={(value) => updatePreset(index, { label: value })}
              placeholder={t(language, 'calendar.label')}
            />
            <MiniInput
              ariaLabel={t(language, 'calendar.startTime')}
              type="time"
              value={preset.time}
              onChange={(value) => updatePreset(index, { time: value })}
            />
            <MiniInput
              ariaLabel={t(language, 'calendar.duration')}
              type="number"
              value={String(preset.durationMinutes)}
              onChange={(value) => updatePreset(index, { durationMinutes: Number(value) || 120 })}
              suffix={t(language, 'common.minutes')}
            />
            <button
              type="button"
              disabled={presets.length <= 1}
              onClick={() => removePreset(index)}
              style={{
                width: 24,
                height: 24,
                minHeight: 24,
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: presets.length <= 1 ? 'var(--muted-2)' : 'var(--status-danger)',
                cursor: presets.length <= 1 ? 'not-allowed' : 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                display: 'grid',
                placeItems: 'center',
              }}
              aria-label={t(language, 'common.delete')}
            >
              ×
            </button>
          </div>
          <MiniInput
            ariaLabel={t(language, 'calendar.defaultTitle')}
            value={preset.title}
            onChange={(value) => updatePreset(index, { title: value })}
            placeholder={msg('기본 제목')}
          />
        </div>
      ))}

      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.35 }}>
        {msg('시간을 누르면 종료시간은 소요시간만큼 자동 입력됩니다. 기본 소요시간은 120분입니다.')}
      </p>
    </div>
  )
}

export function MiniInput({
  ariaLabel,
  onChange,
  placeholder,
  suffix,
  type = 'text',
  value,
}: {
  ariaLabel: string
  onChange: (value: string) => void
  placeholder?: string
  suffix?: string
  type?: string
  value: string
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        height: 32,
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: '#fff',
        padding: '0 7px',
        boxSizing: 'border-box',
      }}
    >
      <input
        aria-label={ariaLabel}
        type={type}
        min={type === 'number' ? 15 : undefined}
        max={type === 'number' ? 480 : undefined}
        step={type === 'number' ? 15 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={{
          display: 'block',
          minWidth: 0,
          width: '100%',
          maxWidth: '100%',
          border: 'none',
          background: 'transparent',
          color: 'var(--ink)',
          font: 'inherit',
          fontSize: 11.5,
          fontWeight: 650,
          outline: 'none',
          padding: 0,
          boxSizing: 'border-box',
          accentColor: 'var(--ink)',
          WebkitAppearance: type === 'time' ? 'none' : undefined,
          appearance: type === 'time' ? 'none' : undefined,
        }}
      />
      {suffix && <span style={{ flex: '0 0 auto', color: 'var(--muted)', fontSize: 11, fontWeight: 700 }}>{suffix}</span>}
    </label>
  )
}

