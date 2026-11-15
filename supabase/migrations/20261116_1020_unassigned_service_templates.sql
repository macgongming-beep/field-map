-- Weekly templates are created without dated primary conductor assignments.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.validate_service_event_input(jsonb)'::regprocedure);
  if position('coalesce(p->>''leader_name'','''')='''' or ' in definition)=0 then
    raise exception 'Unexpected service validation definition';
  end if;
  execute replace(definition,'coalesce(p->>''leader_name'','''')='''' or ','');
end $$;
notify pgrst, 'reload schema';
