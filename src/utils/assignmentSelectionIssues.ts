import type { DraftTeam } from '../hooks/assignmentDraft/types'
import type { InformalAsset, TerritoryCard } from '../types'

export type AssignmentSelectionIssue = { teamId: string; teamName: string; kind: 'card' | 'informal'; id: number; name: string }

export function assignmentSelectionIssues(teams: DraftTeam[], cards: TerritoryCard[], assets: InformalAsset[]): AssignmentSelectionIssue[] {
  const cardIds = new Set(cards.map((c) => c.id))
  const byId = new Map(assets.map((a) => [a.id,a]))
  return teams.filter((t) => t.members.length > 0).flatMap((t) => [
    ...t.cardIds.filter((id) => !cardIds.has(id)).map((id): AssignmentSelectionIssue => ({
      teamId: t.id, teamName: t.name, kind: 'card', id, name: `#${id}`,
    })),
    ...(t.informalAssetIds ?? []).filter((id) => {
      const a = byId.get(id)
      return !a || a.archived || a.parentId != null
    }).map((id): AssignmentSelectionIssue => ({
      teamId: t.id, teamName: t.name, kind: 'informal', id, name: byId.get(id)?.name ?? `#${id}`,
    })),
  ])
}
