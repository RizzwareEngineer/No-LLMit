-- The sign-up list for the open dataset (engine/api/waitlist.go). The engine writes and
-- counts with the service key; row level security with no policy keeps every other key out.
-- The unique index is what makes a repeat sign-up a 409 ("already on the list").
create table if not exists public.dataset_waitlist (
  id bigint generated always as identity primary key,
  email text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists dataset_waitlist_email_key on public.dataset_waitlist (lower(email));
alter table public.dataset_waitlist enable row level security;
