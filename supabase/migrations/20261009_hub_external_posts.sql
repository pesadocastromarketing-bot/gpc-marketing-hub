-- Read-only calendar mirror of Meta-owned posts. Never put these into hub_content:
-- doing so could make the Hub publish historical content a second time.
create table if not exists public.hub_external_posts(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hub_organizations(id) on delete cascade,
 meta_asset_id uuid not null references public.hub_meta_assets(id) on delete cascade,
 external_id text not null,
 network text not null check(network in ('Instagram','Facebook')),
 format text not null,
 status text not null check(status in ('published','scheduled')),
 local_date date not null,
 local_time time not null,
 event_at timestamptz not null,
 caption text not null default '',
 thumbnail_url text,
 permalink_url text,
 last_synced_at timestamptz not null default now(),
 unique(organization_id,meta_asset_id,external_id)
);
create index if not exists hub_external_posts_calendar_idx
 on public.hub_external_posts(organization_id,local_date,meta_asset_id);
alter table public.hub_external_posts enable row level security;
revoke all on public.hub_external_posts from anon;
grant select on public.hub_external_posts to authenticated;
drop policy if exists hub_external_posts_org_read on public.hub_external_posts;
create policy hub_external_posts_org_read on public.hub_external_posts
 for select to authenticated using(
 exists(select 1 from public.hub_members m where m.organization_id=hub_external_posts.organization_id and m.user_id=(select auth.uid()))
 );
