-- Keep the follow-up message a model got after an unreadable or illegal first reply.
-- The engine has always sent it as retry_prompt; save_hand dropped it. Rows saved
-- before this migration have retry_prompt null.

alter table public.decision_prompts add column if not exists retry_prompt text;

create or replace function public.save_hand(
  p_hand jsonb,
  p_prompts jsonb,
  p_system_prompt text
) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.system_prompts (prompt_version, system_prompt)
  values (p_hand->'config'->>'prompt_version', coalesce(p_system_prompt, ''))
  on conflict (prompt_version) do update
    set system_prompt = excluded.system_prompt
    where public.system_prompts.system_prompt = '' and excluded.system_prompt <> '';

  insert into public.hands (hand_id, table_id, hand_number, started_at, ended_at, prompt_version, doc)
  values (
    p_hand->>'hand_id',
    p_hand->>'table_id',
    (p_hand->>'hand_number')::integer,
    (p_hand->>'started_at')::timestamptz,
    (p_hand->>'ended_at')::timestamptz,
    p_hand->'config'->>'prompt_version',
    p_hand
  )
  on conflict (hand_id) do nothing;

  insert into public.decision_prompts (prompt_id, hand_id, n, prompt, raw_reply, retry_prompt)
  select p->>'prompt_id', p_hand->>'hand_id', (p->>'n')::integer, p->>'prompt', p->>'raw_reply', p->>'retry_prompt'
  from jsonb_array_elements(p_prompts) as p
  on conflict (prompt_id) do nothing;
end;
$$;

revoke execute on function public.save_hand(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_hand(jsonb, jsonb, text) to service_role;
