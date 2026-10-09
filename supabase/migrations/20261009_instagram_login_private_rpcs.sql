-- API functions expose private Instagram credentials ONLY to server-side service_role.
create or replace function public.hub_ig_login_state_create(
 p_hash text,p_org uuid,p_asset uuid,p_user uuid,p_expires timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into hub_private.instagram_login_states(state_hash,organization_id,asset_id,requested_by,expires_at)
 values(p_hash,p_org,p_asset,p_user,p_expires);
end $$;
create or replace function public.hub_ig_login_state_consume(p_hash text)
returns table(organization_id uuid,asset_id uuid,requested_by uuid)
language sql security definer set search_path='' as $$
 update hub_private.instagram_login_states s set consumed_at=now()
 where s.state_hash=p_hash and s.consumed_at is null and s.expires_at>now()
 returning s.organization_id,s.asset_id,s.requested_by
$$;
create or replace function public.hub_ig_direct_save(
 p_org uuid,p_asset uuid,p_ig_id text,p_username text,p_cipher text,p_iv text,
 p_scopes text[],p_exp timestamptz,p_user uuid)
returns void language sql security definer set search_path='' as $$
 insert into hub_private.instagram_direct_connections(
 organization_id,asset_id,instagram_scoped_id,username,token_ciphertext,token_iv,scopes,expires_at,connected_by,connected_at)
 values(p_org,p_asset,p_ig_id,p_username,p_cipher,p_iv,p_scopes,p_exp,p_user,now())
 on conflict(organization_id,asset_id) do update set
 instagram_scoped_id=excluded.instagram_scoped_id,username=excluded.username,
 token_ciphertext=excluded.token_ciphertext,token_iv=excluded.token_iv,
 scopes=excluded.scopes,expires_at=excluded.expires_at,
 connected_by=excluded.connected_by,connected_at=now()
$$;
create or replace function public.hub_ig_direct_tokens()
returns table(organization_id uuid,asset_id uuid,instagram_scoped_id text,username text,
 token_ciphertext text,token_iv text,scopes text[],expires_at timestamptz)
language sql security definer set search_path='' as $$
 select organization_id,asset_id,instagram_scoped_id,username,
 token_ciphertext,token_iv,scopes,expires_at
 from hub_private.instagram_direct_connections
$$;
create or replace function public.hub_ig_direct_refresh(
 p_org uuid,p_asset uuid,p_cipher text,p_iv text,p_exp timestamptz)
returns void language sql security definer set search_path='' as $$
 update hub_private.instagram_direct_connections
 set token_ciphertext=p_cipher,token_iv=p_iv,expires_at=p_exp
 where organization_id=p_org and asset_id=p_asset
$$;
revoke all on function public.hub_ig_login_state_create(text,uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.hub_ig_login_state_consume(text) from public,anon,authenticated;
revoke all on function public.hub_ig_direct_save(uuid,uuid,text,text,text,text,text[],timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.hub_ig_direct_tokens() from public,anon,authenticated;
revoke all on function public.hub_ig_direct_refresh(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.hub_ig_login_state_create(text,uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.hub_ig_login_state_consume(text) to service_role;
grant execute on function public.hub_ig_direct_save(uuid,uuid,text,text,text,text,text[],timestamptz,uuid) to service_role;
grant execute on function public.hub_ig_direct_tokens() to service_role;
grant execute on function public.hub_ig_direct_refresh(uuid,uuid,text,text,timestamptz) to service_role;
