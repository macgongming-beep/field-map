import {useState} from 'react'
import {CommentSection,type MentionUser} from '../../components/CommentSection'
import {t,type AppLanguage} from '../../i18n'
import type {Role} from '../../types'

export function GroupEventComments({eventId,language,currentVisitor,currentUserId,role,users,focusCommentId,draft,onDraftChange}:{eventId:number;language:AppLanguage;currentVisitor:string;currentUserId?:number|null;role?:Role;users?:MentionUser[];focusCommentId?:number;draft?:string;onDraftChange?:(value:string)=>void}){
  const [open,setOpen]=useState(Boolean(focusCommentId))
  return <details className="gs-group-information gs-event-comments" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>{t(language,'comment.title')}</summary>
    {open&&<CommentSection key={eventId} demandEvent compact targetType="calendar_event" targetId={eventId} language={language}
      currentVisitor={currentVisitor} currentUserId={currentUserId} role={role} users={users} focusCommentId={focusCommentId} initialDraft={draft} onDraftChange={onDraftChange}/>}
  </details>
}
