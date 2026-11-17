import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,test,vi} from 'vitest'
import {GroupEventComments} from './GroupEventComments'
vi.mock('../../components/CommentSection',()=>({CommentSection:({targetId,initialDraft,onDraftChange,compact,demandEvent,focusCommentId}:{targetId:number;initialDraft?:string;onDraftChange?:(s:string)=>void;compact:boolean;demandEvent:boolean;focusCommentId?:number})=><textarea aria-label={`Comments ${targetId}`} data-compact={compact} data-bounded={demandEvent} data-focus={focusCommentId} defaultValue={initialDraft} onChange={e=>onDraftChange?.(e.target.value)}/>}))
afterEach(cleanup)
test('comments use the shared compact composer immediately without a disclosure',()=>{
  const {container,rerender}=render(<GroupEventComments eventId={2} language="ko" currentVisitor="User"/> )
  const composer=screen.getByLabelText('Comments 2')
  expect(composer.getAttribute('data-compact')).toBe('true')
  expect(composer.getAttribute('data-bounded')).toBe('true')
  expect(container.querySelector('details')).toBeNull()
  rerender(<GroupEventComments eventId={3} language="ko" currentVisitor="User"/> )
  expect(screen.queryByLabelText('Comments 2')).toBeNull()
  expect(screen.getByLabelText('Comments 3')).toBeTruthy()
})
test('notification focus and per-group drafts still reach the common composer',()=>{
  const change=vi.fn()
  const {rerender}=render(<GroupEventComments eventId={2} language="ko" currentVisitor="User" focusCommentId={9} draft="draft" onDraftChange={change}/> )
  expect((screen.getByLabelText('Comments 2')as HTMLTextAreaElement).value).toBe('draft')
  expect(screen.getByLabelText('Comments 2').getAttribute('data-focus')).toBe('9')
  fireEvent.change(screen.getByLabelText('Comments 2'),{target:{value:'kept'}});expect(change).toHaveBeenCalledWith('kept')
  rerender(<GroupEventComments eventId={3} language="ko" currentVisitor="User" draft="other"/> )
  expect((screen.getByLabelText('Comments 3')as HTMLTextAreaElement).value).toBe('other')
  rerender(<GroupEventComments eventId={2} language="ko" currentVisitor="User" draft="kept"/> )
  expect((screen.getByLabelText('Comments 2')as HTMLTextAreaElement).value).toBe('kept')
})
