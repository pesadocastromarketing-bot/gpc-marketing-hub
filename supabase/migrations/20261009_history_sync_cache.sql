-- Tracks completed month synchronizations. History remains read-only and organization scoped.
create table if not exists public.hub_history_refreshes(
 organization_id uuid not null references public.hub_organizations(id) on delete cascade,
 month_key text not null check(month_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 refreshed_at timestamptz not null default now(),
 assets_checked integer not null default 0,
 warnings jsonb not null default '[]'::jsonb,
 primary key(organization_id,month_key)
);
alter table public.hub_history_refreshes enable row level security;
revoke all on public.hub_history_refreshes from anon,authenticated;
