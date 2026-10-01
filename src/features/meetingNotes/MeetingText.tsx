// React escapes all content. Supported formatting never interprets HTML or links.
export function MeetingText({ text }: { text: string }) {
  return <div className="meeting-prose">{text.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n')
    if (lines.every(line => line.startsWith('- '))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{line.slice(2)}</li>)}</ul>
    if (lines.every(line => line.startsWith('> '))) return <blockquote key={index}>{lines.map(line => line.slice(2)).join('\n')}</blockquote>
    return <div key={index}>{lines.map((line, i) => line.startsWith('## ') ? <h2 key={i}>{line.slice(3)}</h2> : <p key={i}>{line || '\u00a0'}</p>)}</div>
  })}</div>
}
