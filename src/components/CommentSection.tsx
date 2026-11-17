import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../lib/toast'
import { t, type AppLanguage } from '../i18n'
import type { Role } from '../types'
import { LinkifiedText } from './LinkifiedText'
import { msg } from '../lib/msg'
import {useEventComments} from '../features/groupService/useEventComments'
import {writeEventComment} from '../features/groupService/commentApi'

export type MentionUser = {
  id: number
  name: string
  role?: string
}

type CommentTargetType = 'notice' | 'calendar_event'

type CommentRecord = {
  id: number
  target_type: CommentTargetType
  target_id: number
  author_id: number | null
  author_name: string
  content: string
  mention_ids: number[] | null
  mention_names: string[] | null
  created_at: string
  deleted_at: string | null
}

type CommentSectionProps = {
  targetType: CommentTargetType
  targetId: number
  currentVisitor: string
  currentUserId?: number | null
  role?: Role
  users?: MentionUser[]
  title?: string
  compact?: boolean
  headerRight?: import('react').ReactNode  // sec-head 우측 (예: '채팅 열기' 링크)
  language?: AppLanguage
  demandEvent?: boolean
  focusCommentId?: number
  initialDraft?:string
  onDraftChange?:(value:string)=>void
}

function getMentionQuery(value: string) {
  const match = value.match(/(^|\s)@([^\s@]*)$/)
  return match ? match[2] : null
}

function insertMention(value: string, userName: string) {
  return value.replace(/(^|\s)@([^\s@]*)$/, `$1@${userName} `)
}

function getMentionPayload(value: string, users: MentionUser[]) {
  const mentioned = users.filter((user) => value.includes(`@${user.name}`))
  return {
    ids: mentioned.map((user) => user.id),
    names: mentioned.map((user) => user.name),
  }
}

function formatCommentTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function CommentSection({
  targetType,
  targetId,
  currentVisitor,
  currentUserId,
  role = 'user',
  users = [],
  title,
  compact = false,
  headerRight,
  language = 'ko',
  demandEvent = false,
  focusCommentId,
  initialDraft='',onDraftChange,
}: CommentSectionProps) {
  const lang = language
  const [legacyComments, setComments] = useState<CommentRecord[]>([])
  const [draft, updateDraft] = useState(initialDraft)
  const setDraft=(value:string|((old:string)=>string))=>{const next=typeof value==='function'?value(draft):value;updateDraft(next);onDraftChange?.(next)}
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [menuCommentId, setMenuCommentId] = useState<number | null>(null)
  const [legacyLoading, setLoading] = useState(false)
  const [missingTable, setMissingTable] = useState(false)
  const [saving,setSaving]=useState(false)
  const feed=useEventComments(targetId,demandEvent,focusCommentId)
  const comments=demandEvent?feed.rows:legacyComments
  const loading=demandEvent?feed.loading:legacyLoading
  const focused=useRef<number|undefined>(undefined)
  useEffect(()=>{
    if(demandEvent&&focusCommentId&&focused.current!==focusCommentId&&comments.some(c=>c.id===focusCommentId)){
      document.getElementById(`comment-${targetId}-${focusCommentId}`)?.scrollIntoView?.({block:'center'});focused.current=focusCommentId
    }
  },[demandEvent,focusCommentId,targetId,comments])

  const mentionQuery = getMentionQuery(draft)
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return []
    return users
      .filter((user) => user.name !== currentVisitor && user.name.includes(mentionQuery))
      .slice(0, 6)
  }, [currentVisitor, mentionQuery, users])

  const fetchComments = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('comments')
      .select('id, target_type, target_id, author_id, author_name, content, mention_ids, mention_names, created_at, deleted_at')
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    if (error) {
      console.warn('댓글을 불러오지 못했습니다. comments 테이블이 아직 없을 수 있습니다.', error)
      setMissingTable(true)
      setComments([])
      setLoading(false)
      return
    }

    setMissingTable(false)
    setComments((data as CommentRecord[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if(demandEvent)return
    void fetchComments()

    const channel = supabase
      .channel(`comments:${targetType}:${targetId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `target_id=eq.${targetId}` },
        () => void fetchComments(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, targetType,demandEvent])

  const submitComment = async () => {
    const content = draft.trim()
    if (!content||saving) return

    const mentions = getMentionPayload(content, users)
    if(demandEvent){
      setSaving(true)
      try{feed.accept(await writeEventComment(targetId,{content,author_id:currentUserId,author_name:currentVisitor,mention_ids:mentions.ids,mention_names:mentions.names}));setDraft('')}
      catch(error){reportCommentError(error)}finally{setSaving(false)}
      return
    }
    const { error } = await supabase.from('comments').insert({
      target_type: targetType,
      target_id: targetId,
      author_id: currentUserId ?? null,
      author_name: currentVisitor,
      content,
      mention_ids: mentions.ids,
      mention_names: mentions.names,
    })

    if (error) {
      reportCommentError(error)
      return
    }

    setDraft('')
    await fetchComments()
  }

  const deleteComment = async (comment: CommentRecord) => {
    if(demandEvent){
      if(saving)return;setSaving(true)
      try{feed.accept(await writeEventComment(targetId,{id:comment.id,deleted_at:new Date().toISOString()}))}
      catch{showToast(msg('댓글을 삭제하지 못했습니다.'),'error')}finally{setSaving(false)}
      return
    }
    const { error } = await supabase
      .from('comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', comment.id)

    if (error) {
      showToast(msg('댓글을 삭제하지 못했습니다.'), 'error')
      return
    }
    await fetchComments()
  }

  const startEdit = (comment: CommentRecord) => {
    setMenuCommentId(null)
    setEditingId(comment.id)
    setEditDraft(comment.content)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft('')
  }

  const saveEdit = async (comment: CommentRecord) => {
    const content = editDraft.trim()
    if (!content) return

    const mentions = getMentionPayload(content, users)
    if(demandEvent){
      if(saving)return;setSaving(true)
      try{feed.accept(await writeEventComment(targetId,{id:comment.id,content,mention_ids:mentions.ids,mention_names:mentions.names}));cancelEdit()}
      catch{showToast(msg('댓글을 수정하지 못했습니다.'),'error')}finally{setSaving(false)}
      return
    }
    const { error } = await supabase
      .from('comments')
      .update({
        content,
        mention_ids: mentions.ids,
        mention_names: mentions.names,
        updated_at: new Date().toISOString(),
      })
      .eq('id', comment.id)

    if (error) {
      showToast(msg('댓글을 수정하지 못했습니다.'), 'error')
      return
    }

    cancelEdit()
    await fetchComments()
  }

  const canDelete = (comment: CommentRecord) =>
    comment.author_name === currentVisitor || role === 'admin' || role === 'developer'

  const canEdit = (comment: CommentRecord) => comment.author_name === currentVisitor
  const hasActions = (comment: CommentRecord) => canEdit(comment) || canDelete(comment)

  if (!demandEvent&&missingTable) {
    return (
      <section className={`comment-section${compact ? ' comment-section--compact' : ''}`}>
        <div className="comment-empty">{t(lang, 'comment.notReady')}</div>
      </section>
    )
  }

  return (
    <section className={`comment-section${compact ? ' comment-section--compact' : ''}`}>
      <div className="comment-section__head">
        <strong>{title ?? t(lang, 'comment.title')}</strong>
        {!demandEvent&&<span>{t(lang, 'comment.count', { n: comments.length })}</span>}
        {headerRight && <div style={{ marginLeft: 'auto' }}>{headerRight}</div>}
      </div>

      <div className="comment-list">
        {demandEvent&&feed.error&&<div role="alert">{feed.error==='session'?msg('로그인 세션을 확인할 수 없습니다. 앱에서 다시 로그인해 주세요.'):msg('댓글을 불러오지 못했습니다.')} <button type="button" onClick={feed.retry}>{msg('다시 시도')}</button></div>}
        {demandEvent&&!feed.error&&feed.focusMissing&&<p role="status">{msg('삭제되었거나 찾을 수 없는 댓글입니다.')}</p>}
        {demandEvent&&feed.hasMore&&<button type="button" disabled={loading} onClick={()=>void feed.more()}>{msg('이전 댓글 보기')}</button>}
        {loading && comments.length === 0 ? (
          <div className="comment-empty">{t(lang, 'comment.loading')}</div>
        ) : comments.length === 0 && !(demandEvent&&(feed.error||feed.focusMissing)) ? (
          <div className="comment-empty">{t(lang, 'comment.empty')}</div>
        ) : (
          comments.map((comment) => (
            <article className="comment-item" key={comment.id} id={`comment-${targetId}-${comment.id}`}>
              <div className="comment-item__avatar">{comment.author_name.slice(0, 1)}</div>
              <div className="comment-item__body">
                <div className="comment-item__meta">
                  <strong>{comment.author_name}</strong>
                  <span>{formatCommentTime(comment.created_at)}</span>
                  {hasActions(comment) && editingId !== comment.id && (
                    <div className="comment-action-menu">
                      <button
                        aria-label={msg('댓글 메뉴')}
                        className="comment-action-trigger"
                        onClick={() => setMenuCommentId((id) => id === comment.id ? null : comment.id)}
                        type="button"
                      >
                        ⋯
                      </button>
                      {menuCommentId === comment.id && (
                        <div className="comment-action-popover">
                          {canEdit(comment) && <button onClick={() => startEdit(comment)} type="button">{t(lang, 'common.edit')}</button>}
                          {canDelete(comment) && <button className="danger" onClick={() => { setMenuCommentId(null); void deleteComment(comment) }} type="button">{t(lang, 'common.delete')}</button>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {editingId === comment.id ? (
                  <div className="comment-edit-box">
                    <textarea
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void saveEdit(comment)
                        if (event.key === 'Escape') cancelEdit()
                      }}
                      rows={2}
                      value={editDraft}
                    />
                    <div className="comment-edit-actions">
                      <button disabled={saving||!editDraft.trim()} onClick={() => saveEdit(comment)} type="button">{t(lang, 'common.save')}</button>
                      <button onClick={cancelEdit} type="button">{t(lang, 'common.cancel')}</button>
                    </div>
                  </div>
                ) : (
                  <p><LinkifiedText text={comment.content} /></p>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      <div className="comment-composer">
        <textarea
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submitComment()
          }}
          placeholder={t(lang, 'comment.placeholder')}
          rows={compact ? 1 : 3}
          value={draft}
        />
        {mentionSuggestions.length > 0 && (
          <div className="mention-menu">
            {mentionSuggestions.map((user) => (
              <button
                key={user.id}
                onClick={() => setDraft((value) => insertMention(value, user.name))}
                type="button"
              >
                <span>{user.name.slice(0, 1)}</span>
                {user.name}
              </button>
            ))}
          </div>
        )}
        <button disabled={saving||!draft.trim()||(demandEvent&&feed.error==='session')} onClick={submitComment} type="button">{t(lang, 'comment.submit')}</button>
      </div>
    </section>
  )
}

function reportCommentError(error: unknown) {
  console.error('댓글 등록 실패', error)
  showToast(msg('댓글을 등록하지 못했습니다. V1+ SQL 적용 여부를 확인해 주세요.'), 'error')
}
