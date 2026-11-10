-- Hands in which no model call succeeded (every action a provider or service failure) are
-- outages, not poker. Since 2026-11-09 the engine voids them instead of saving them; the
-- ones saved before were moved here, with their prompts, so stats and the dataset (which
-- read hands only) never see them. Row level security with no policy: service key only.
create table if not exists public.hands_voided (like public.hands including all);
create table if not exists public.decision_prompts_voided (like public.decision_prompts including all);
alter table public.hands_voided enable row level security;
alter table public.decision_prompts_voided enable row level security;
