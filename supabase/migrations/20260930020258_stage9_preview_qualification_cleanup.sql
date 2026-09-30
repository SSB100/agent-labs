-- Live qualification now launches through the authenticated owner action.
drop function if exists public.stage9_begin_preview_qualification(text,text,uuid,text);
