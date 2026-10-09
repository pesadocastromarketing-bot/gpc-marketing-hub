-- Separate Instagram Login tokens from Facebook Login business portfolios.
create schema if not exists hub_private;
create table if not exists hub_private.instagram_login_states(
  state_hash text primary key,
  organization_id uuid not null references public.hub_organizations(id) on delete cascade,
  requested_by uuid not null,
  asset_id uuid not null references public.hub_meta_assets(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists ig_login_state_expiry on hub_private.instagram_login_states(expires_at);
create table if not exists hub_private.instagram_direct_connections(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hub_organizations(id) on delete cascade,
  asset_id uuid not null references public.hub_meta_assets(id) on delete cascade,
  instagram_scoped_id text not null,
  username text not null,
  token_ciphertext text not null,
  token_iv text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  connected_by uuid not null,
  connected_at timestamptz not null default now(),
  unique (organization_id,asset_id),
  unique (organization_id,instagram_scoped_id)
);
create index if not exists ig_direct_conn_expires_idx on hub_private.instagram_direct_connections(expires_at);
revoke all on hub_private.instagram_login_states from public, anon, authenticated;
revoke all on hub_private.instagram_direct_connections from public, anon, authenticated;
