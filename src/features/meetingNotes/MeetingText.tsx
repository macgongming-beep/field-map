import { LinkifiedText } from '../../components/LinkifiedText'

// Only explicit web links are supported; HTML and executable URL schemes stay text.
function MeetingInline({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s<>"()]+\))/gi)
  return <>{parts.map((part, index) => {
    const match = /^\[([^\]\n]+)\]\((https?:\/\/[^\s<>"()]+)\)$/i.exec(part)
    if (!match) return <LinkifiedText key={index} text={part} />
    try {
      const url = new URL(match[2])
      if (!['https:', 'http:'].includes(url.protocol)) return part
      return <a key={index} href={url.href} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>{match[1]}</a>
    } catch { return part }
  })}</>
}

// React escapes all content, including HTML inside link labels.
export function MeetingText({ text }: { text: string }) {
  return <div className="meeting-prose">{text.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n')
    if (lines.every(line => line.startsWith('- '))) return <ul key={index}>{lines.map((line, i) => <li key={i}><MeetingInline text={line.slice(2)} /></li>)}</ul>
    if (lines.every(line => line.startsWith('> '))) return <blockquote key={index}><MeetingInline text={lines.map(line => line.slice(2)).join('\n')} /></blockquote>
    return <div key={index}>{lines.map((line, i) => line.startsWith('## ') ? <h2 key={i}><MeetingInline text={line.slice(3)} /></h2> : <p key={i}><MeetingInline text={line || '\u00a0'} /></p>)}</div>
  })}</div>
}
