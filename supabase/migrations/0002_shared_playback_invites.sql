-- Dream Watch — shared playback controls, playback chat logs, and the invite-join fix.

-- ---------------------------------------------------------------------
-- 1. Member guard: only police direct client updates.
--    The old trigger was SECURITY DEFINER and keyed off auth.uid(), so it also
--    blocked join_party() (a definer RPC run *for* the user) from turning an
--    'invited' row into 'joined'. As SECURITY INVOKER, current_user is
--    'authenticated' only for direct client writes; RPCs run as their owner.
-- ---------------------------------------------------------------------
create or replace function public.guard_member_update()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;  -- RPCs and service role
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

-- ---------------------------------------------------------------------
-- 2. Who last changed playback ("Paused by Riya").
-- ---------------------------------------------------------------------
alter table public.parties add column if not exists playback_by uuid references public.profiles(id);

alter table public.parties alter column settings
  set default '{"ai_moderation": true, "guests_can_poll": false, "allow_cameras": true, "shared_controls": true}'::jsonb;

-- ---------------------------------------------------------------------
-- 3. Shared playback control.
--    Any joined member may change playback (unless the host turned
--    settings.shared_controls off). Only the playback columns can change, the
--    version is bumped server-side, and a chat log line is written from a fixed
--    vocabulary, so members can't post arbitrary system messages.
--    Rapid repeats by the same person (e.g. three "10 s back" taps) update one
--    log line instead of flooding the chat.
-- ---------------------------------------------------------------------
create or replace function public.playback_action(
  p_party uuid, p_action text, p_patch jsonb, p_label text default null
)
returns int language plpgsql security definer set search_path = public as $$
declare pa parties; me profiles; v int; log_line text; recent uuid;
begin
  select * into pa from parties where id = p_party;
  if pa is null then raise exception 'party not found'; end if;
  if pa.status <> 'live' then raise exception 'party not live'; end if;
  if not exists (select 1 from party_members where party_id = p_party and user_id = auth.uid() and status = 'joined') then
    raise exception 'not a member';
  end if;
  if pa.host_id <> auth.uid() and coalesce(pa.settings->>'shared_controls', 'true') = 'false' then
    raise exception 'host controls playback';
  end if;
  select * into me from profiles where id = auth.uid();

  update parties set
    is_playing      = case when p_patch ? 'is_playing'      then (p_patch->>'is_playing')::boolean else is_playing end,
    anchor_position = case when p_patch ? 'anchor_position' then (p_patch->>'anchor_position')::numeric else anchor_position end,
    anchor_time     = case when p_patch ? 'anchor_time'     then (p_patch->>'anchor_time')::double precision else anchor_time end,
    live_delay_s    = case when p_patch ? 'live_delay_s'    then greatest(0, (p_patch->>'live_delay_s')::numeric) else live_delay_s end,
    playback_version = playback_version + 1,
    playback_by     = auth.uid()
  where id = p_party
  returning playback_version into v;

  if p_label is not null and p_label !~ '^[0-9]{1,3}:[0-9]{2}$' then p_label := null; end if;
  log_line := me.display_name || ' ' || case p_action
    when 'pause'        then 'paused the video'
    when 'play'         then 'resumed the video'
    when 'go_live'      then 'went back to live'
    when 'skip_back'    then 'went back to ' || coalesce(p_label, 'an earlier moment')
    when 'skip_forward' then 'skipped ahead to ' || coalesce(p_label, 'a later moment')
    when 'seek'         then 'jumped to ' || coalesce(p_label, 'a new moment')
    else 'changed playback'
  end;

  select id into recent from messages
   where party_id = p_party and author_type = 'system'
     and meta->>'kind' = 'playback' and meta->>'actor' = auth.uid()::text
     and meta->>'action' = p_action
     and created_at > now() - interval '5 seconds'
   order by created_at desc limit 1;

  if recent is not null then
    update messages set body = log_line where id = recent;
  else
    insert into messages (party_id, author_type, body, meta)
    values (p_party, 'system', log_line, jsonb_build_object('kind', 'playback', 'actor', auth.uid(), 'action', p_action));
  end if;
  return v;
end $$;

revoke execute on function public.playback_action(uuid, text, jsonb, text) from public, anon;
grant execute on function public.playback_action(uuid, text, jsonb, text) to authenticated;
