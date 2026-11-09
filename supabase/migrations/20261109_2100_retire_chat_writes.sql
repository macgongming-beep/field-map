-- Apply with psql --single-transaction after a backup. Reads and retention stay unchanged.
CREATE OR REPLACE FUNCTION public.send_chat_message(
  p_token uuid, p_event_id integer, p_content text,
  p_mention_ids integer[] DEFAULT '{}', p_mention_names text[] DEFAULT '{}'
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.verify_session(p_token);
  RAISE EXCEPTION '채팅이 종료되었습니다';
END;
$$;

CREATE OR REPLACE FUNCTION public.send_chat_image(
  p_token uuid, p_event_id integer, p_image_url text, p_caption text DEFAULT NULL,
  p_mention_ids integer[] DEFAULT '{}', p_mention_names text[] DEFAULT '{}'
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.verify_session(p_token);
  RAISE EXCEPTION '채팅이 종료되었습니다';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_system_chat_message(
  p_token uuid, p_event_id integer, p_content text
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.verify_session(p_token);
  RAISE EXCEPTION '채팅이 종료되었습니다';
END;
$$;

REVOKE ALL ON FUNCTION public.send_chat_message(uuid,integer,text,integer[],text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_chat_image(uuid,integer,text,text,integer[],text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_system_chat_message(uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_chat_message(uuid,integer,text,integer[],text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_chat_image(uuid,integer,text,text,integer[],text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_system_chat_message(uuid,integer,text) TO anon, authenticated;

DROP POLICY IF EXISTS chat_attachments_upload ON storage.objects;

-- Never delete comment mentions or event_change alerts that happen to use openChat.
DELETE FROM public.notifications
WHERE type = 'chat'
   OR (type = 'mention' AND (
     link ~ '^/calendar\?([^#]*&)?openChat=[1-9][0-9]*(&[^#]*)?(#.*)?$'
     OR link ~ '^/calendar/events/[1-9][0-9]*/chat/?$'
   ));

NOTIFY pgrst, 'reload schema';
