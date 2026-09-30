import type { AssignmentSelectionIssue } from '../../utils/assignmentSelectionIssues'
import { msg } from '../../lib/msg'

export function AssignmentSelectionIssues({ issues, canEdit, onRemove }: {
  issues: AssignmentSelectionIssue[]; canEdit: boolean; onRemove: (issue: AssignmentSelectionIssue) => void
}) {
  if (issues.length === 0) return null
  return <section className="asg-selection-issues" aria-label={msg('배정할 수 없는 선택')}>
    <strong>{msg('배정할 수 없는 선택')}</strong>
    <ul>{issues.map((issue) => <li key={`${issue.teamId}:${issue.kind}:${issue.id}`}>
      <span>{issue.teamName} · {msg(issue.kind === 'card' ? '카드' : '비공식')} · {issue.name} (ID: {issue.id})</span>
      <button type="button" disabled={!canEdit} onClick={() => onRemove(issue)}
        aria-label={msg('{name} 선택 해제', { name: `${issue.teamName} · ${issue.name}` })}>{msg('선택 해제')}</button>
    </li>)}</ul>
  </section>
}
