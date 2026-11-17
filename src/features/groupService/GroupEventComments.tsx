import {CommentSection,type MentionUser} from '../../components/CommentSection'
import type {AppLanguage} from '../../i18n'
import type {Role} from '../../types'

export function GroupEventComments({eventId,language,currentVisitor,currentUserId,role,users,focusCommentId,draft,onDraftChange}:{eventId:number;language:AppLanguage;currentVisitor:string;currentUserId?:number|null;role?:Role;users?:MentionUser[];focusCommentId?:number;draft?:string;onDraftChange?:(value:string)=>void}){
  return <div className="gs-event-comments">
    <CommentSection key={eventId} demandEvent compact targetType="calendar_event" targetId={eventId} language={language}
      currentVisitor={currentVisitor} currentUserId={currentUserId} role={role} users={users} focusCommentId={focusCommentId} initialDraft={draft} onDraftChange={onDraftChange}/>
  </div>
}
