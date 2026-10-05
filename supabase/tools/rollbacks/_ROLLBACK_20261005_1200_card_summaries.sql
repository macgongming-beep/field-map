-- Disable any future summary-read client flag before removing the RPC.
drop function if exists public.get_card_summaries(uuid,integer[]);
notify pgrst, 'reload schema';
