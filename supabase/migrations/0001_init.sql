-- Dream Watch — schema, RLS, RPCs and realtime (HANDOFF.md §6)
create extension if not exists pgcrypto;

-- =====================================================================
-- Tables
-- =====================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text not null,
  avatar_color text not null default '#7CFF6B',
  is_subscribed boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, avatar_color, is_subscribed)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)),
    (array['#7CFF6B','#FFB547','#5AC8FA','#FF6B9D','#B18CFF','#FF8A5B','#4FD1C5','#F6E05E'])[1 + (hashtext(new.id::text) & 7)],
    false
  );
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();

create table public.matches (
  id text primary key,
  mode text not null check (mode in ('live', 'replay')),
  title text not null,
  competition text,
  youtube_id text not null,
  config jsonb not null,
  sort_order int not null default 0
);

create table public.match_events (
  id text primary key,
  match_id text not null references public.matches(id) on delete cascade,
  period int not null,
  elapsed_in_period_s numeric,
  video_time numeric not null,
  clock text,
  type text not null,
  importance text not null check (importance in ('key', 'detail')),
  team text,
  player text,
  description text not null,
  score_after jsonb,
  data jsonb not null default '{}'::jsonb,
  approximate boolean not null default false
);
create index match_events_match_time_idx on public.match_events (match_id, video_time);

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id),
  host_id uuid not null references public.profiles(id),
  name text not null,
  status text not null default 'lobby' check (status in ('lobby', 'live', 'ended')),
  is_playing boolean not null default true,
  anchor_position numeric,
  anchor_time double precision,
  live_delay_s numeric not null default 0,
  playback_version int not null default 0,
  settings jsonb not null default '{"ai_moderation": true, "guests_can_poll": false, "allow_cameras": true}'::jsonb,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.party_members (
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'guest' check (role in ('host', 'guest')),
  status text not null default 'invited' check (status in ('invited', 'joined', 'removed')),
  muted boolean not null default false,
  team_supported text,
  joined_at timestamptz,
  primary key (party_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid references public.profiles(id),
  author_type text not null default 'user' check (author_type in ('user', 'gaffer', 'system')),
  body text not null check (char_length(body) between 1 and 1000),
  reply_to uuid references public.messages(id) on delete set null,
  event_id text references public.match_events(id) on delete set null,
  video_time numeric,
  meta jsonb not null default '{}'::jsonb,
  flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now()
);
create index messages_party_created_idx on public.messages (party_id, created_at);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  created_by text not null default 'gaffer',
  question text not null,
  options jsonb not null,
  resolve_rule jsonb not null,
  opens_at_video_time numeric not null,
  votes_close_at_video_time numeric not null,
  closes_at_video_time numeric not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'void')),
  correct_option_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index polls_party_idx on public.polls (party_id, created_at);

create table public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table public.ai_requests (
  id bigserial primary key,
  user_id uuid not null,
  party_id uuid,
  kind text not null,
  created_at timestamptz not null default now()
);
create index ai_requests_user_time_idx on public.ai_requests (user_id, created_at);
create index ai_requests_party_time_idx on public.ai_requests (party_id, kind, created_at);

-- =====================================================================
-- Helper functions
-- =====================================================================

create or replace function public.is_party_member(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from party_members
    where party_id = pid and user_id = auth.uid() and status <> 'removed'
  );
$$;

create or replace function public.is_party_host(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from parties where id = pid and host_id = auth.uid());
$$;

create or replace function public.get_server_time()
returns double precision language sql stable as $$
  select extract(epoch from clock_timestamp())::double precision;
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.profiles       enable row level security;
alter table public.matches        enable row level security;
alter table public.match_events   enable row level security;
alter table public.parties        enable row level security;
alter table public.party_members  enable row level security;
alter table public.messages       enable row level security;
alter table public.polls          enable row level security;
alter table public.poll_votes     enable row level security;
alter table public.ai_requests    enable row level security;   -- no policies: service role only

-- Profiles: public fields readable; email is not granted to clients.
create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke select, update on public.profiles from authenticated, anon;
grant select (id, display_name, avatar_color, is_subscribed, created_at) on public.profiles to authenticated;
grant update (display_name, avatar_color) on public.profiles to authenticated;

create policy "matches readable" on public.matches for select to authenticated using (true);
create policy "events readable"  on public.match_events for select to authenticated using (true);

create policy "members read party" on public.parties for select to authenticated
  using (host_id = auth.uid() or public.is_party_member(id));
create policy "host updates party" on public.parties for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());

create policy "members read members" on public.party_members for select to authenticated
  using (public.is_party_member(party_id) or public.is_party_host(party_id) or user_id = auth.uid());
create policy "host manages members" on public.party_members for update to authenticated
  using (public.is_party_host(party_id));
create policy "member updates own team" on public.party_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.party_members from authenticated;
grant update (team_supported, muted, status) on public.party_members to authenticated;

create policy "members read messages" on public.messages for select to authenticated
  using (public.is_party_member(party_id));
create policy "members send messages" on public.messages for insert to authenticated
  with check (
    author_type = 'user'
    and user_id = auth.uid()
    and flagged = false
    and public.is_party_member(party_id)
    and not exists (
      select 1 from party_members pm
      where pm.party_id = messages.party_id and pm.user_id = auth.uid() and pm.muted
    )
  );

create policy "members read polls" on public.polls for select to authenticated
  using (public.is_party_member(party_id));
create policy "members read votes" on public.poll_votes for select to authenticated
  using (exists (select 1 from polls p where p.id = poll_id and public.is_party_member(p.party_id)));
create policy "members vote once on open polls" on public.poll_votes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from polls p where p.id = poll_id and p.status = 'open' and public.is_party_member(p.party_id))
  );

-- =====================================================================
-- RPCs
-- =====================================================================

create or replace function public.check_invites(emails text[])
returns table (email text, status text, display_name text)
language sql security definer stable set search_path = public as $$
  select e.email,
         case when p.id is null then 'no_account'
              when p.is_subscribed then 'subscribed'
              else 'not_subscribed' end,
         p.display_name
  from unnest(emails) as e(email)
  left join profiles p on lower(p.email) = lower(trim(e.email));
$$;

-- p_id lets the client know the invite link before the party exists (shown in the
-- Create Party modal for invitees who aren't subscribed yet).
create or replace function public.create_party(
  p_match_id text, p_name text, p_emails text[], p_id uuid default null, p_settings jsonb default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me is null then raise exception 'not signed in'; end if;
  if not me.is_subscribed then raise exception 'subscription required'; end if;

  insert into parties (id, match_id, host_id, name, status, settings)
  values (
    coalesce(p_id, gen_random_uuid()), p_match_id, me.id, p_name, 'lobby',
    coalesce(p_settings, '{"ai_moderation": true, "guests_can_poll": false, "allow_cameras": true}'::jsonb)
  ) returning id into pid;

  insert into party_members (party_id, user_id, role, status, joined_at)
  values (pid, me.id, 'host', 'joined', now());

  insert into party_members (party_id, user_id, role, status)
  select pid, p.id, 'guest', 'invited'
  from profiles p
  where lower(p.email) = any (select lower(trim(x)) from unnest(coalesce(p_emails, '{}')) x)
    and p.is_subscribed and p.id <> me.id
  on conflict do nothing;

  insert into messages (party_id, author_type, body)
  values (pid, 'system', me.display_name || ' created the party');
  return pid;
end $$;

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
  where pa.id = p_party;
$$;

create or replace function public.join_party(p_party uuid, p_team text default null)
returns text language plpgsql security definer set search_path = public as $$
declare me profiles; existing party_members; pstatus text;
begin
  select * into me from profiles where id = auth.uid();
  if me is null then raise exception 'not signed in'; end if;
  if not me.is_subscribed then raise exception 'subscription required'; end if;
  select status into pstatus from parties where id = p_party;
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
    values (p_party, 'system', me.display_name || ' joined the party');
  end if;
  return pstatus;
end $$;

create or replace function public.mock_subscribe()
returns void language sql security definer set search_path = public as $$
  update profiles set is_subscribed = true where id = auth.uid();
$$;

create or replace function public.report_message(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select party_id into pid from messages where id = p_message;
  if pid is null or not public.is_party_member(pid) then raise exception 'not a member'; end if;
  update messages set flagged = true, flag_reason = coalesce(flag_reason, 'Reported by a member')
  where id = p_message and author_type = 'user';
end $$;

create or replace function public.unflag_message(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select party_id into pid from messages where id = p_message;
  if pid is null or not public.is_party_host(pid) then raise exception 'host only'; end if;
  update messages set flagged = false where id = p_message;
end $$;

-- Deterministic: the answer comes from match_events, never from the caller.
create or replace function public.resolve_poll(p_poll uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p polls; mid text; r jsonb; ans text; t text;
begin
  select * into p from polls where id = p_poll;
  if p is null then raise exception 'poll not found'; end if;
  if p.status <> 'open' then return p.correct_option_id; end if;
  if not public.is_party_member(p.party_id) then raise exception 'not a member'; end if;
  select match_id into mid from parties where id = p.party_id;
  r := p.resolve_rule;

  if r->>'kind' = 'goal_in_window' then
    ans := case when exists (select 1 from match_events where match_id = mid and type = 'goal'
             and video_time > p.opens_at_video_time and video_time <= p.closes_at_video_time) then 'yes' else 'no' end;
  elsif r->>'kind' = 'card_in_window' then
    ans := case when exists (select 1 from match_events where match_id = mid and type = 'card'
             and video_time > p.opens_at_video_time and video_time <= p.closes_at_video_time) then 'yes' else 'no' end;
  elsif r->>'kind' = 'player_scores_in_window' then
    ans := case when exists (select 1 from match_events where match_id = mid and type = 'goal' and player = r->>'player'
             and video_time > p.opens_at_video_time and video_time <= p.closes_at_video_time) then 'yes' else 'no' end;
  elsif r->>'kind' in ('next_goal_team', 'next_card_team') then
    select team into t from match_events
      where match_id = mid and type = case when r->>'kind' = 'next_goal_team' then 'goal' else 'card' end
        and video_time > p.opens_at_video_time and video_time <= p.closes_at_video_time
      order by video_time limit 1;
    ans := coalesce(t, 'none');
  elsif r->>'kind' = 'shootout_kick_scored' then
    select case when description ilike '%SCORES%' then 'yes' else 'no' end into ans from match_events
      where match_id = mid and type = 'shootout_kick'
        and video_time > p.opens_at_video_time and video_time <= p.closes_at_video_time
      order by video_time limit 1;
    if ans is null then
      update polls set status = 'void', resolved_at = now() where id = p_poll;
      return null;
    end if;
  else
    update polls set status = 'void', resolved_at = now() where id = p_poll;
    return null;
  end if;

  update polls set status = 'resolved', correct_option_id = ans, resolved_at = now() where id = p_poll;
  insert into messages (party_id, author_type, body, meta)
  values (p.party_id, 'system', 'Poll result: ' || p.question || ' → ' ||
          coalesce((select o->>'label' from jsonb_array_elements(p.options) o where o->>'id' = ans), ans),
          jsonb_build_object('poll_id', p.id));
  return ans;
end $$;

create or replace function public.void_poll(p_poll uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select party_id into pid from polls where id = p_poll;
  if pid is null or not public.is_party_host(pid) then raise exception 'host only'; end if;
  update polls set status = 'void', resolved_at = now() where id = p_poll and status = 'open';
end $$;

-- Host-only system message (full time, etc.). Clients cannot insert system rows directly.
create or replace function public.post_system_message(p_party uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_party_host(p_party) then raise exception 'host only'; end if;
  insert into messages (party_id, author_type, body) values (p_party, 'system', left(p_body, 1000));
end $$;

revoke execute on function public.check_invites(text[]), public.create_party(text, text, text[], uuid, jsonb),
  public.get_invite_preview(uuid), public.join_party(uuid, text), public.mock_subscribe(),
  public.report_message(uuid), public.unflag_message(uuid), public.resolve_poll(uuid), public.void_poll(uuid),
  public.post_system_message(uuid, text) from public, anon;
grant execute on function public.check_invites(text[]), public.create_party(text, text, text[], uuid, jsonb),
  public.get_invite_preview(uuid), public.join_party(uuid, text), public.mock_subscribe(),
  public.report_message(uuid), public.unflag_message(uuid), public.resolve_poll(uuid), public.void_poll(uuid),
  public.post_system_message(uuid, text), public.get_server_time() to authenticated;
grant execute on function public.get_server_time() to anon;

-- =====================================================================
-- Guard trigger on party_members (§6.5)
-- =====================================================================

create or replace function public.guard_member_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- service role
  if public.is_party_host(new.party_id) then
    if old.user_id = auth.uid() and (new.status <> old.status or new.muted <> old.muted) then
      raise exception 'host cannot mute or remove themselves';
    end if;
    return new;
  end if;
  if old.user_id <> auth.uid() then raise exception 'not allowed'; end if;
  if new.status <> old.status or new.muted <> old.muted or new.role <> old.role then
    raise exception 'only the host can change status or mute';
  end if;
  return new;
end $$;

create trigger party_members_guard before update on public.party_members
for each row execute function public.guard_member_update();

-- =====================================================================
-- Realtime
-- =====================================================================

alter publication supabase_realtime add table
  public.parties, public.party_members, public.messages, public.polls, public.poll_votes;
