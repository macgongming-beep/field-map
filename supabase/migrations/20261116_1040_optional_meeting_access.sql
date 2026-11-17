-- A virtual meeting may be announced before connection details are available.
do $$
declare definition text; required_check text;
begin
  definition:=pg_get_functiondef('private.validate_service_event_input(jsonb)'::regprocedure);
  required_check:=$needle$if coalesce(p#>>'{access,joinUrl}','')='' and coalesce(p#>>'{access,meetingNumber}','')='' then raise exception 'Meeting link or number required'; end if;$needle$;
  if position(required_check in definition)=0 then raise exception 'Unexpected service access validation'; end if;
  execute replace(definition,required_check,'');
end $$;
notify pgrst, 'reload schema';
