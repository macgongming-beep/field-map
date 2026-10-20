import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { InformalCardsTab } from './InformalCardsTab'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../lib/toast', () => ({ showToast: toast }))
vi.mock('./MapCanvas', () => ({ MapCanvas: () => null }))
afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear() })

test('bulk refresh failure retains selection without success toast and allows retry', async () => {
  const move = vi.fn()
    .mockResolvedValueOnce({ failed: [], refreshFailed: true })
    .mockResolvedValueOnce({ failed: [] })
  render(<InformalCardsTab role="admin" currentVisitor="test" language="ko" expandedStateKey="group-test"
    informalAssets={[{ id: 1, name: 'Asset A', kind: '비공식구역', imageUrl: '', imagePath: '', uploadedBy: 'test', createdAt: '', archived: false, groupId: 1 }]}
    informalGroups={[1, 2].map(id => ({ id, name: `Group ${id}`, position: id, createdBy: 'test', createdAt: '' }))}
    onUpload={vi.fn()} onDelete={vi.fn()} onCreateGroup={vi.fn()} onRenameGroup={vi.fn()}
    onDeleteGroup={vi.fn()} onMoveAsset={vi.fn()} onMoveMany={move} />)
  fireEvent.click(screen.getByRole('button', { name: 'Group 11' }))
  fireEvent.click(screen.getAllByLabelText('더보기')[0])
  fireEvent.click(screen.getByRole('button', { name: '선택', exact: true }))
  fireEvent.click(screen.getByText('Asset A'))
  fireEvent.click(screen.getByRole('button', { name: '그룹 이동', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Group 2', exact: true }))
  await vi.waitFor(() => expect(move).toHaveBeenCalledTimes(1))
  expect(toast).not.toHaveBeenCalled()
  expect(screen.getByText('1개 선택')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Group 2', exact: true }))
  await vi.waitFor(() => expect(toast).toHaveBeenCalled())
})
