-- Disable the demo catalog client before removing its read-only endpoint.
drop function public.browse_restaurants(uuid,text,text,text,integer,integer,boolean);
notify pgrst, 'reload schema';
