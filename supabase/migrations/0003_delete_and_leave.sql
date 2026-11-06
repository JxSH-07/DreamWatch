-- Dream Watch — hosts can delete a party; guests can leave one (or decline an invite).

alter table public.parties add column if not exists deleted_at timestamptz;

-- 'left' = the member chose to leave. Unlike 'removed', they can rejoin via the invite link.
alter table public.party_members drop constraint if exists party_members_status_check;
alter table public.party_members add constraint party_members_status_check
  check (status in ('invited', 'joined', 'removed', 'left'));

-- Only invited and joined members count as members (RLS, chat, polls, Edge Functions).
create or replace function public.is_party_member(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from party_members
    where party_id = pid and user_id = auth.uid() and status in ('invited', 'joined')
  );
$$;

-- Host-only. Soft delete: the party ends for anyone still in the room (they get the
-- realtime UPDATE and see the recap), and it disappears from every list and invite link.
create or replace function public.delete_party(p_party uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  if not public.is_party_host(p_party) then raise exception 'host only'; end if;
  select * into me from profiles where id = auth.uid();
  insert into messages (party_id, author_type, body)
  values (p_party, 'system', me.display_name || ' deleted the party');
  update parties
     set status = 'ended', ended_at = coalesce(ended_at, now()), is_playing = false, deleted_at = now()
   where id = p_party;
end $$;

-- A guest leaves a party (or declines an invite). The host deletes instead.
create or replace function public.leave_party(p_party uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles; mine party_members;
begin
  select * into me from profiles where id = auth.uid();
  select * into mine from party_members where party_id = p_party and user_id = auth.uid();
  if mine is null or mine.status not in ('invited', 'joined') then raise exception 'not a member'; end if;
  if mine.role = 'host' then raise exception 'host must delete the party instead'; end if;
  update party_members set status = 'left' where party_id = p_party and user_id = auth.uid();
  if mine.status = 'joined' then
    insert into messages (party_id, author_type, body)
    values (p_party, 'system', me.display_name || ' left the party');
  end if;
end $$;

-- Deleted parties behave as "not found" for invite links and joining.
create or replace function public.get_invite_preview(p_party uuid)
returns table (party_id uuid, party_name text, host_name text, host_color text, match_id text, match_title text,
               match_mode text, party_status text, joined_count int, viewer_is_subscribed boolean, viewer_member_status text)
language sql security definer stable set search_path = public as $$
  select pa.id, pa.name, h.display_name, h.avatar_color, m.id, m.title, m.mode, pa.status,
         (select count(*)::int from party_members where party_id = pa.id and status = 'joined'),
         (select is_subscribed from profiles where id = auth.uid()),
         (select status from party_members where party_id = pa.id and user_id = auth.uid())
  from parties pa
  join profiles h on h.id = pa.host_id
  join matches m on m.id = pa.match_id
  where pa.id = p_party and pa.deleted_at is null;
$$;

create or replace function public.join_party(p_party uuid, p_team text default null)
returns text language plpgsql security definer set search_path = public as $$
declare me profiles; existing party_members; pstatus text;
begin
  select * into me from profiles where id = auth.uid();
  if me is null then raise exception 'not signed in'; end if;
  if not me.is_subscribed then raise exception 'subscription required'; end if;
  select status into pstatus from parties where id = p_party and deleted_at is null;
  if pstatus is null then raise exception 'party not found'; end if;
  if pstatus = 'ended' then raise exception 'party ended'; end if;
  select * into existing from party_members where party_id = p_party and user_id = me.id;
  if existing.status = 'removed' then raise exception 'removed by host'; end if;

  insert into party_members (party_id, user_id, role, status, team_supported, joined_at)
  values (p_party, me.id, 'guest', 'joined', p_team, now())
  on conflict (party_id, user_id) do update
    set status = 'joined', joined_at = coalesce(party_members.joined_at, now()),
        team_supported = coalesce(excluded.team_supported, party_members.team_supported);

  if existing.status is distinct from 'joined' then
    insert into messages (party_id, author_type, body)
    values (p_party, 'system', me.display_name || case when existing.status = 'left' then ' rejoined the party' else ' joined the party' end);
  end if;
  return pstatus;
end $$;

revoke execute on function public.delete_party(uuid), public.leave_party(uuid) from public, anon;
grant execute on function public.delete_party(uuid), public.leave_party(uuid) to authenticated;
