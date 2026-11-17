import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,test,vi} from 'vitest'
import {GroupEventComments} from './GroupEventComments'
vi.mock('../../components/CommentSection',()=>({CommentSection:({targetId,initialDraft,onDraftChange}:{targetId:number;initialDraft?:string;onDraftChange?:(s:string)=>void})=><textarea aria-label={`Comments ${targetId}`} defaultValue={initialDraft} onChange={e=>onDraftChange?.(e.target.value)}/>}))
afterEach(cleanup)
test('closed comments are unmounted, expanded comments use exact event, and collapse releases them',async()=>{
  render(<GroupEventComments eventId={2} language="ko" currentVisitor="User"/> )
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByText('댓글'))
  await screen.findByLabelText('Comments 2')
  fireEvent.click(screen.getByText('댓글'))
  await waitFor(()=>expect(screen.queryByRole('textbox')).toBeNull())
})
test('notification opens immediately and saved draft returns after collapsing',async()=>{
  const change=vi.fn()
  const {rerender}=render(<GroupEventComments eventId={2} language="ko" currentVisitor="User" focusCommentId={9} draft="draft" onDraftChange={change}/> )
  expect((screen.getByLabelText('Comments 2')as HTMLTextAreaElement).value).toBe('draft')
  fireEvent.change(screen.getByLabelText('Comments 2'),{target:{value:'kept'}});expect(change).toHaveBeenCalledWith('kept')
  rerender(<GroupEventComments eventId={2} language="ko" currentVisitor="User" focusCommentId={9} draft="kept" onDraftChange={change}/> )
  fireEvent.click(screen.getByText('댓글'));await waitFor(()=>expect(screen.queryByRole('textbox')).toBeNull())
  fireEvent.click(screen.getByText('댓글'))
  expect((await screen.findByLabelText('Comments 2')as HTMLTextAreaElement).value).toBe('kept')
})
