-- Hand history for the shared table. See docs/hand-history.md.

-- One row per system prompt the models have been given.
create table public.system_prompts (
  prompt_version text primary key,
  system_prompt  text not null,
  created_at     timestamptz not null default now()
);

-- One row per hand. doc is the full hand record; each action in it carries a
-- prompt_id pointing into decision_prompts.
create table public.hands (
  hand_id        text primary key,
  table_id       text not null,
  hand_number    integer not null,
  started_at     timestamptz not null,
  ended_at       timestamptz not null,
  prompt_version text not null references public.system_prompts (prompt_version),
  doc            jsonb not null,
  created_at     timestamptz not null default now()
);
create index hands_started_at_idx on public.hands (started_at);

-- The exact text each model was sent and what it sent back, kept apart from
-- hands so analytics never have to read it.
create table public.decision_prompts (
  prompt_id text primary key,
  hand_id   text not null references public.hands (hand_id) on delete cascade,
  n         integer not null,
  prompt    text not null,
  raw_reply text not null
);
create index decision_prompts_hand_id_idx on public.decision_prompts (hand_id);

-- No policies: only the service role (the engine) can read or write.
alter table public.system_prompts   enable row level security;
alter table public.hands            enable row level security;
alter table public.decision_prompts enable row level security;

-- Saves one hand and its prompts in a single transaction. Saving the same hand
-- twice is a no-op, so the engine can retry safely. If the system prompt text was
-- not available when a version was first seen, it is filled in when it arrives.
create function public.save_hand(
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

  insert into public.decision_prompts (prompt_id, hand_id, n, prompt, raw_reply)
  select p->>'prompt_id', p_hand->>'hand_id', (p->>'n')::integer, p->>'prompt', p->>'raw_reply'
  from jsonb_array_elements(p_prompts) as p
  on conflict (prompt_id) do nothing;
end;
$$;

revoke execute on function public.save_hand(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_hand(jsonb, jsonb, text) to service_role;
