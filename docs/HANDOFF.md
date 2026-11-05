# Dream Watch — Build Spec for Claude Code

> **Read this whole document before writing code.** It is the single source of truth for what to build. Where the Claude Design export and this spec disagree on *behaviour*, follow this spec. Where they disagree on *look and feel*, follow the Claude Design export.

---

## 0. TL;DR

Build **Dream Watch**: a watch-party feature for a sports streaming platform. Subscribed friends watch a football match together in sync, chat in real time, react with emojis, vote on AI-generated predictions, and tag an AI match companion, **@Gaffer**, who explains what's happening on the pitch (offsides, handballs, cards, tactical substitutions) using real match event data.

- **Frontend:** React (Vite), JavaScript (no TypeScript), React Router.
- **Backend:** Supabase (Postgres, Auth, Realtime, Edge Functions).
- **AI:** Anthropic Claude API, called only from Supabase Edge Functions.
- **Video:** YouTube IFrame Player API, embedding two full-match videos.
- **Hosting:** Vercel (frontend) + Supabase cloud (backend).

This is a **one-day prototype for a job assessment (Dream11)**. Evaluators will open the deployed link, sign up with any email, subscribe with one click, and click around — often alone, using an incognito window as their second user. Prioritise: it works end-to-end on the deployed URL, the AI companion is impressive and honest, and the Watch Party Room looks polished. Skip anything not listed here.

---

## 1. Inputs you have

| Input | Location (adjust to actual repo) | Use |
|---|---|---|
| Claude Design export | `/design-export/` | Visual source of truth: layout, components, colours, typography, motion. Port it into React components; keep its CSS/styling approach. |
| Match config | `/data/matches.json` | Two matches: YouTube IDs, period start/end video offsets, loop range, lineups, stats. |
| Final events | `/data/arg_fra_events.json` | 135 events for Argentina v France (StatsBomb Open Data), each with exact `video_time`. |
| Betis–Barça events | `/data/betis_barca_events.json` | 38 events for Real Betis 3–5 Barcelona (from match reports, minute-accurate, `approximate: true`). |
| Time helpers | `/data/matchTime.js` | `liveEdge`, `clampToLive`, `behindLive`, `videoToMatchClock`, `getEventsUpTo`, `scoreAt`, `recentEvents`. Move into `src/lib/matchTime.js` and reuse in Edge Functions. |

### Event object shape (both event files)

```json
{
  "id": "uuid-or-betbar-001",
  "period": 2,
  "period_label": "2nd half",
  "clock": "80'",
  "elapsed_in_period_s": 2064.9,
  "video_time": 5360.9,
  "video_time_hms": "1:29:20",
  "type": "goal",
  "importance": "key",
  "team": "France",
  "player": "Kylian Mbappé",
  "description": "GOAL! Kylian Mbappé scores for France (penalty). Argentina 2–1 France",
  "score_after": { "Argentina": 2, "France": 1 },
  "data": { "xg": 0.78, "shot_type": "Penalty" }
}
```

- `type` values: `period_start`, `period_end`, `goal`, `shot`, `card`, `foul`, `handball`, `penalty_awarded`, `offside`, `substitution`, `tactical_shift`, `injury`, `shootout_kick`, `var_decision`.
- `importance`: `key` → shown in the Timeline panel. `detail` → **not** shown in the Timeline, but sent to Gaffer as context.
- Betis–Barça events have `approximate: true` and no `elapsed_in_period_s`.
- **Compute video time at runtime** as `match.period_starts[e.period] + e.elapsed_in_period_s` when `elapsed_in_period_s` exists, else use `e.video_time`. This lets a single offset edit in `matches.json` re-align a whole period.

---

## 2. Product scope

### Must build (in priority order)
1. Sign up / sign in with any email + password, and a one-click mock subscription (header Subscribe button + subscription gate modal).
2. Home page with the live match (hero) and the completed match ("Watch party a classic").
3. Solo match viewing (live and replay modes) — the player, scorebug, controls.
4. Create Watch Party → invite by email with subscription check → Lobby → Room.
5. Synced playback across all party members (host controls playback).
6. Real-time chat + emoji reactions + presence.
7. **@Gaffer AI companion** in chat (most important AI feature).
8. **Match Timeline panel** with "Ask Gaffer" on each event.
9. AI-generated predictions/polls with auto-resolution and a party leaderboard.
10. Host controls (mute, remove, end party) + AI chat moderation.
11. Non-subscriber invite landing page (subscribe, then join).
12. "Testing alone?" hint in the Lobby (open the invite link in an incognito window).

### Explicitly out of scope
- Real payments or real subscription management (subscription is a boolean flag).
- Real live streams, DRM, voice/video calls.
- Push notifications, email sending of invites (invites are in-app only; a shareable link is shown).
- Mobile native apps (responsive web only).
- Demo accounts, bots or simulated participants. To test with more than one person, use an incognito window, another browser, or a friend.

---

## 3. Tech stack & key libraries

| Concern | Choice |
|---|---|
| Build tool | Vite + React 18, JavaScript (`.jsx` / `.js`) |
| Routing | `react-router-dom` v6 |
| Backend client | `@supabase/supabase-js` v2 |
| State | React context + hooks. No Redux. |
| Styling | Whatever the Claude Design export uses (keep it). If it's plain CSS, use CSS modules or a single `styles/` folder with CSS variables. |
| Icons | `lucide-react` (unless the design export uses something else) |
| Video | YouTube IFrame Player API, loaded via script tag `https://www.youtube.com/iframe_api` |
| Edge Functions | Supabase Edge Functions (Deno). Write in JavaScript. |
| AI | Claude Messages API via `fetch` from Edge Functions. Model from env var `GAFFER_MODEL` (default `claude-haiku-5-5` for fast chat replies). |
| Hosting | Vercel for frontend. Add `vercel.json` SPA rewrite so deep links like `/party/abc` work. |

---

## 4. Repository structure

```
dream-watch/
├── data/                         # provided JSON + matchTime.js (source copies)
├── design-export/                # Claude Design output (reference only)
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql         # schema, RLS, functions, realtime (Section 6)
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── matchTime.js      # copy of src/lib/matchTime.js
│   │   │   ├── matches.js        # loads match config + events from DB
│   │   │   ├── claude.js         # Claude API wrapper
│   │   │   └── cors.js
│   │   ├── gaffer/index.js       # @Gaffer Q&A
│   │   ├── generate-poll/index.js
│   │   └── moderate-message/index.js
│   └── seed/
│       └── seed.js               # Node script: matches + events only
├── src/
│   ├── main.jsx
│   ├── App.jsx                   # routes
│   ├── lib/
│   │   ├── supabase.js           # Supabase client (default session storage)
│   │   ├── matchTime.js
│   │   ├── serverClock.js        # server time offset (see 9.4)
│   │   └── playback.js           # party position maths (see 9)
│   ├── context/
│   │   ├── AuthContext.jsx       # session + profile (incl. is_subscribed) + refreshProfile()
│   │   └── PartyContext.jsx      # party row, members, realtime channel
│   ├── hooks/
│   │   ├── useYouTubePlayer.js
│   │   ├── useMatch.js           # loads match + events
│   │   ├── usePlaybackSync.js
│   │   ├── useChat.js
│   │   ├── usePolls.js
│   │   ├── usePresence.js
│   │   └── useSubscriptionGate.js # requireSubscription(action) → opens SubscribeModal
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── Home.jsx
│   │   ├── Watch.jsx             # solo viewing: /watch/:matchId
│   │   ├── Lobby.jsx             # /party/:partyId/lobby
│   │   ├── Room.jsx              # /party/:partyId
│   │   ├── Invite.jsx            # /invite/:partyId (join flow / non-subscriber)
│   │   └── NotFound.jsx
│   └── components/
│       ├── layout/Header.jsx
│       ├── match/MatchCard.jsx, Scorebug.jsx, LiveBadge.jsx
│       ├── player/VideoPlayer.jsx, PlayerControls.jsx, LiveSeekBar.jsx, SyncPill.jsx, ReactionOverlay.jsx
│       ├── party/CreatePartyModal.jsx, ParticipantStrip.jsx, TestingAloneHint.jsx
│       ├── subscription/SubscribeButton.jsx, SubscribeModal.jsx
│       ├── panel/SidePanel.jsx (tabs), ChatTab.jsx, TimelineTab.jsx, PollsTab.jsx, PeopleTab.jsx
│       ├── chat/Message.jsx, GafferMessage.jsx, ModeratedMessage.jsx, ChatInput.jsx, MentionChip.jsx
│       ├── timeline/TimelineEvent.jsx
│       └── polls/PollCard.jsx, Leaderboard.jsx
├── .env.example
├── vercel.json
└── README.md
```

---

## 5. Environment variables

**Frontend (`.env`, exposed to browser — public values only):**
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_LIVE_EPOCH=1793491200        # optional override (2026-11-01T00:00Z); default in matchTime.js
```

**Supabase Edge Function secrets (`supabase secrets set ...`) — never in frontend:**
```
ANTHROPIC_API_KEY=
GAFFER_MODEL=claude-haiku-5-5
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are available to Edge Functions automatically.)

**Seed script (`supabase/seed/.env`, local only):**
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

> The Claude API key must never appear in frontend code, `VITE_` variables, or the git repo.

---

## 6. Database (Supabase Postgres)

Put all of this in `supabase/migrations/0001_init.sql`. Treat it as the intended design; fix syntax if Supabase complains, but keep the semantics.

### 6.1 Tables

```sql
create extension if not exists pgcrypto;

-- ---------- Profiles ----------
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
    -- pick a deterministic colour from a small palette
    (array['#7CFF6B','#FFB547','#5AC8FA','#FF6B9D','#B18CFF','#FF8A5B','#4FD1C5','#F6E05E'])[1 + (hashtext(new.id::text) & 7)],
    false                                       -- every new account starts unsubscribed
  );
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- Matches & events ----------
create table public.matches (
  id text primary key,                         -- 'arg-fra-2022-final', 'betis-barca-2025-md15'
  mode text not null check (mode in ('live', 'replay')),
  title text not null,
  competition text,
  youtube_id text not null,
  config jsonb not null,                       -- the full object from matches.json
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

-- ---------- Parties ----------
create table public.parties (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id),
  host_id uuid not null references public.profiles(id),
  name text not null,
  status text not null default 'lobby' check (status in ('lobby', 'live', 'ended')),
  -- Host-controlled playback state (see Section 9)
  is_playing boolean not null default true,
  anchor_position numeric,                     -- video seconds at anchor_time
  anchor_time double precision,                -- server epoch seconds
  live_delay_s numeric not null default 0,     -- live mode: seconds behind the live edge
  playback_version int not null default 0,     -- bump on every host change
  settings jsonb not null default '{"ai_moderation": true, "guests_can_poll": false}'::jsonb,
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

-- ---------- Chat ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid references public.profiles(id),          -- null for gaffer/system
  author_type text not null default 'user' check (author_type in ('user', 'gaffer', 'system')),
  body text not null check (char_length(body) between 1 and 1000),
  reply_to uuid references public.messages(id),
  event_id text references public.match_events(id),     -- event attached via "Ask Gaffer"
  video_time numeric,                                   -- sender's synced position when sent
  meta jsonb not null default '{}'::jsonb,              -- gaffer: { about_event_id, about_label, rule, status }
  flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now()
);
create index messages_party_created_idx on public.messages (party_id, created_at);

-- ---------- Polls ----------
create table public.polls (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  created_by text not null default 'gaffer',            -- 'gaffer' or a user id as text
  question text not null,
  options jsonb not null,                               -- [{ "id": "yes", "label": "Yes" }, ...]
  resolve_rule jsonb not null,                          -- see Section 13
  opens_at_video_time numeric not null,
  votes_close_at_video_time numeric not null,          -- voting locks (opens + 90 s); enforced in UI
  closes_at_video_time numeric not null,               -- outcome window ends; then resolve
  status text not null default 'open' check (status in ('open', 'resolved', 'void')),
  correct_option_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

-- ---------- Rate limiting for AI calls ----------
create table public.ai_requests (
  id bigserial primary key,
  user_id uuid not null,
  party_id uuid,
  kind text not null,                                   -- 'gaffer' | 'poll' | 'moderation'
  created_at timestamptz not null default now()
);
create index ai_requests_user_time_idx on public.ai_requests (user_id, created_at);
```

### 6.2 Helper functions

```sql
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

-- Server clock for playback sync (Section 9.4)
create or replace function public.get_server_time()
returns double precision language sql stable as $$
  select extract(epoch from clock_timestamp());
$$;
```

### 6.3 Row Level Security

```sql
alter table public.profiles       enable row level security;
alter table public.matches        enable row level security;
alter table public.match_events   enable row level security;
alter table public.parties        enable row level security;
alter table public.party_members  enable row level security;
alter table public.messages       enable row level security;
alter table public.polls          enable row level security;
alter table public.poll_votes     enable row level security;
alter table public.ai_requests    enable row level security;   -- no policies: service role only

-- Profiles: anyone signed in can see public fields; email column is NOT granted.
create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke select on public.profiles from authenticated, anon;
grant select (id, display_name, avatar_color, is_subscribed, created_at) on public.profiles to authenticated;
grant update (display_name, avatar_color) on public.profiles to authenticated;
-- is_subscribed is only changed through mock_subscribe() (6.4).
-- The signed-in user's own email comes from the auth session, not this table.

-- Matches & events: read-only for signed-in users
create policy "matches readable" on public.matches for select to authenticated using (true);
create policy "events readable"  on public.match_events for select to authenticated using (true);

-- Parties
create policy "members read party" on public.parties for select to authenticated
  using (host_id = auth.uid() or public.is_party_member(id));
create policy "host updates party" on public.parties for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());
-- Inserts happen through create_party() only.

-- Members
create policy "members read members" on public.party_members for select to authenticated
  using (public.is_party_member(party_id) or public.is_party_host(party_id));
create policy "host manages members" on public.party_members for update to authenticated
  using (public.is_party_host(party_id));
create policy "member updates own team" on public.party_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- NOTE: the second policy lets a member update their own row. Restrict columns:
revoke update on public.party_members from authenticated;
grant update (team_supported, muted, status) on public.party_members to authenticated;
-- and enforce in a trigger that non-hosts can only change team_supported (see 6.5).

-- Messages
create policy "members read messages" on public.messages for select to authenticated
  using (public.is_party_member(party_id));
create policy "members send messages" on public.messages for insert to authenticated
  with check (
    author_type = 'user'
    and user_id = auth.uid()
    and public.is_party_member(party_id)
    and not exists (
      select 1 from party_members pm
      where pm.party_id = messages.party_id and pm.user_id = auth.uid() and pm.muted
    )
  );
-- Gaffer/system messages and flag updates are written with the service role (Edge Functions) or RPCs.

-- Polls & votes
create policy "members read polls" on public.polls for select to authenticated
  using (public.is_party_member(party_id));
create policy "members read votes" on public.poll_votes for select to authenticated
  using (exists (select 1 from polls p where p.id = poll_id and public.is_party_member(p.party_id)));
create policy "members vote once on open polls" on public.poll_votes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from polls p where p.id = poll_id and p.status = 'open' and public.is_party_member(p.party_id))
  );
```

### 6.4 RPC functions (call with `supabase.rpc(...)`)

```sql
-- Check a list of emails before inviting. Never exposes anything except status.
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

-- Create a party, add host as joined member, invite subscribed emails.
create or replace function public.create_party(p_match_id text, p_name text, p_emails text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me is null then raise exception 'not signed in'; end if;
  if not me.is_subscribed then raise exception 'subscription required'; end if;

  insert into parties (match_id, host_id, name, status)
  values (p_match_id, me.id, p_name, 'lobby') returning id into pid;

  insert into party_members (party_id, user_id, role, status, joined_at)
  values (pid, me.id, 'host', 'joined', now());

  insert into party_members (party_id, user_id, role, status)
  select pid, p.id, 'guest', 'invited'
  from profiles p
  where lower(p.email) = any (select lower(trim(x)) from unnest(p_emails) x)
    and p.is_subscribed and p.id <> me.id
  on conflict do nothing;

  insert into messages (party_id, author_type, body)
  values (pid, 'system', me.display_name || ' created the party');
  return pid;
end $$;

-- Preview for the invite page (works before joining).
create or replace function public.get_invite_preview(p_party uuid)
returns table (party_id uuid, party_name text, host_name text, match_id text, match_title text,
               match_mode text, party_status text, viewer_is_subscribed boolean, viewer_member_status text)
language sql security definer stable set search_path = public as $$
  select pa.id, pa.name, h.display_name, m.id, m.title, m.mode, pa.status,
         (select is_subscribed from profiles where id = auth.uid()),
         (select status from party_members where party_id = pa.id and user_id = auth.uid())
  from parties pa
  join profiles h on h.id = pa.host_id
  join matches m on m.id = pa.match_id
  where pa.id = p_party;
$$;

-- Join via invite link. Anyone subscribed and not removed can join (link = invitation).
create or replace function public.join_party(p_party uuid, p_team text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles; existing party_members;
begin
  select * into me from profiles where id = auth.uid();
  if me is null then raise exception 'not signed in'; end if;
  if not me.is_subscribed then raise exception 'subscription required'; end if;
  if (select status from parties where id = p_party) = 'ended' then raise exception 'party ended'; end if;
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
end $$;

-- One-click mock subscription (the "Yes" button in SubscribeModal). No payment.
create or replace function public.mock_subscribe()
returns void language sql security definer set search_path = public as $$
  update profiles set is_subscribed = true where id = auth.uid();
$$;

-- Report a message (any member). Hides it pending host review.
create or replace function public.report_message(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select party_id into pid from messages where id = p_message;
  if not public.is_party_member(pid) then raise exception 'not a member'; end if;
  update messages set flagged = true, flag_reason = coalesce(flag_reason, 'Reported by a member')
  where id = p_message and author_type = 'user';
end $$;

-- Host-only: unflag ("Show anyway" / restore).
create or replace function public.unflag_message(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select party_id into pid from messages where id = p_message;
  if not public.is_party_host(pid) then raise exception 'host only'; end if;
  update messages set flagged = false where id = p_message;
end $$;

-- Resolve a poll from match data (Section 13). Deterministic: answer comes from events, not the caller.
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

-- Host-only: void an open poll (host rewound before it opened, or the live loop wrapped).
create or replace function public.void_poll(p_poll uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select party_id into pid from polls where id = p_poll;
  if not public.is_party_host(pid) then raise exception 'host only'; end if;
  update polls set status = 'void', resolved_at = now() where id = p_poll and status = 'open';
end $$;

-- Grant RPC execution to signed-in users
grant execute on function public.check_invites(text[]), public.create_party(text, text, text[]),
  public.get_invite_preview(uuid), public.join_party(uuid, text), public.mock_subscribe(),
  public.report_message(uuid), public.unflag_message(uuid), public.resolve_poll(uuid), public.void_poll(uuid),
  public.get_server_time() to authenticated;
```

### 6.5 Guard trigger on `party_members`

Non-hosts may only change their own `team_supported`. Hosts may change `muted` and `status` (for others, never their own role).

```sql
create or replace function public.guard_member_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- service role / RPCs running as definer
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
```
(The service role bypasses RLS but not triggers; `auth.uid()` is null for the service role, which is why the first line exits early.)

> Flagged messages are still readable through RLS. The UI hides their body from non-hosts (Section 15). That's acceptable for a demo; note it in the README as a known limitation.

### 6.6 Realtime

```sql
alter publication supabase_realtime add table
  public.parties, public.party_members, public.messages, public.polls, public.poll_votes;
```

Realtime channel per party: `party:{partyId}`, used for
- **Postgres changes** (filtered with `party_id=eq.{id}` / `id=eq.{id}`): `messages` (INSERT, UPDATE), `polls` (INSERT, UPDATE), `poll_votes` (INSERT), `party_members` (INSERT, UPDATE), `parties` (UPDATE — playback and status).
- **Broadcast** events: `reaction` `{ emoji, userId }`, `typing` `{ userId }`, `gaffer_thinking` `{ requestId, question }`.
- **Presence**: `{ userId, displayName, avatarColor, team }` — drives online dots in the participant strip and People tab.

---

## 7. Auth & subscription

### 7.1 Supabase Auth settings
- Email + password provider **on**. **Disable "Confirm email"** (Authentication → Providers → Email). People sign up with any email and must be able to use the app immediately; Supabase's built-in mailer also allows only a few emails per hour.
- No magic links, no OAuth, no demo accounts.

### 7.2 Login page (`/login`)
- Hero: Dream Watch logo + tagline "Watch together, wherever you are."
- Two tabs: **Sign in** (email, password) and **Create account** (display name, email, password ≥ 6 chars).
  - Sign up → `supabase.auth.signUp({ email, password, options: { data: { display_name } } })`. With email confirmation off, the user is signed in straight away. The DB trigger creates their profile, **unsubscribed**.
  - Sign in → `signInWithPassword`.
  - Show friendly errors ("That email already has an account — sign in instead", "Wrong email or password").
- After auth, redirect to the `?next=` param or `/`.
- If `next` starts with `/invite/`, open on the **Create account** tab with a banner: "Create an account to join the watch party." (Most invited friends won't have an account yet.)

### 7.3 Sessions
Use the default supabase-js client (session in `localStorage`): users stay signed in, and every tab of the same browser is the same user.
```js
// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 20 } },
});
```
To be a second user on the same computer, testers use an **incognito/private window** or another browser (Section 14).

### 7.4 Subscription (mock, one click)
- `AuthContext` holds the session and the signed-in user's profile (including `is_subscribed`) and exposes `refreshProfile()`.
- **Header Subscribe button**: shown only to unsubscribed users — an accent-coloured "Subscribe" pill in the header. Subscribed users instead get a "Premium" badge next to their avatar.
- **Subscription gate**: `useSubscriptionGate()` returns `requireSubscription(action)`. If subscribed, it runs `action` immediately; otherwise it opens `SubscribeModal` and runs `action` after the user subscribes. Use it on:
  - clicking any match card or its **Watch** button,
  - **Start Watch Party**,
  - **Join party** on the invite page,
  - directly opening `/watch/:matchId` or `/party/:partyId` while unsubscribed (show the page shell with a locked player and a Subscribe button).
- **SubscribeModal**: title "Subscribe to Dream Watch?", short benefit list (Watch live and classic matches · Host watch parties with friends · Ask Gaffer, your AI match expert), small note "Demo: no payment is taken." Buttons: **Yes, subscribe** and **Cancel**.
  - Yes → `rpc('mock_subscribe')` → `refreshProfile()` → toast "You're subscribed 🎉" → close → continue the pending action (e.g. open the match the user clicked).
  - Cancel → close; nothing else happens.

### 7.5 Route guard
`<RequireAuth>` wrapper: if there's no session, redirect to `/login?next=<current path>`. All routes except `/login` are protected. Subscription is checked per action (7.4), not by the route guard, so unsubscribed users can still browse the home page.

---

## 8. Pages & user flows

### 8.1 Routes

| Route | Page | Notes |
|---|---|---|
| `/login` | Login | Public — sign in / create account |
| `/` | Home | Live hero + classics |
| `/watch/:matchId` | Watch (solo) | Player + scorebug + timeline + "Start a Watch Party" |
| `/party/:partyId/lobby` | Lobby | Pre-start waiting room |
| `/party/:partyId` | Room | The main experience |
| `/invite/:partyId` | Invite | Shareable link target; handles join + non-subscriber gate |

Add `vercel.json`: `{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }`.

### 8.2 Home (`/`)
- Header: logo, nav (Home, Live, Matches — Live/Matches can scroll to sections), **Subscribe** button (unsubscribed users only, 7.4) or **Premium** badge, avatar menu with "Sign out".
- **Live hero**: Argentina vs France. Show the scorebug values for the **current live edge** (score + clock from `scoreAt`/`videoToMatchClock` at `liveEdge(serverNow)`), pulsing LIVE badge, a fake-but-plausible viewer count (e.g. 1.2M ± small random drift). Buttons: **Watch** → `/watch/arg-fra-2022-final`; **Start Watch Party** → opens CreatePartyModal.
- **"Watch party a classic"** section: Betis 3–5 Barcelona card with "Full Time" badge. Buttons: Watch / Start Watch Party.
- **"Your parties"** section: parties the user hosts or is a member of (status lobby/live), each with Rejoin button.
- Unsubscribed users see the same page; Watch, Start Watch Party and match-card clicks go through the subscription gate (7.4). Show a small lock icon on those buttons.

### 8.3 Create Watch Party modal
1. Party name (prefilled: `"<Display name>'s <Home> v <Away> party"`).
2. Invite by email: input + Add (Enter key also adds). Debounce-free: on Add, call `rpc('check_invites', { emails: [email] })` and show the row with a "Checking…" spinner for at least 400 ms (so the verification moment is visible), then:
   - `subscribed` → green "Subscribed ✓ — will be invited"
   - `not_subscribed` → amber "Not subscribed yet — share the invite link; they'll be asked to subscribe when they open it" + "Copy invite link"
   - `no_account` → grey "No Dream Watch account yet — share the invite link; they can sign up from it" + "Copy invite link"
3. Toggle: "AI moderation" (default on).
4. **Create party** → `rpc('create_party', { p_match_id, p_name, p_emails })` → write settings via `parties` update → navigate to `/party/:id/lobby`.

### 8.4 Lobby (`/party/:partyId/lobby`)
- Party name, match card, invite link (`${origin}/invite/${partyId}`) with Copy button.
- Members list (from `party_members` + profiles): avatar, name, status pill (Joined / Invited), online dot from presence.
- "Pick your side" segmented control (Home / Away / Neutral) → updates own `team_supported`.
- Host: **Start party** button → `parties.update({ status: 'live', anchor_position: <start>, anchor_time: serverNow(), is_playing: true, live_delay_s: 0, playback_version: v+1 })`. For live matches the start position is simply the live edge (delay 0); for replay it's `period_starts["1"] - 5` (5 s before kick-off).
- Guests: "Waiting for <host> to start…" When the `parties` UPDATE arrives with `status = 'live'`, everyone navigates to `/party/:id` automatically.
- **Testing alone?** hint card (Section 14).
- If the party is already `live` when a member opens the lobby URL, redirect to the room.

### 8.5 Invite page (`/invite/:partyId`)
Call `rpc('get_invite_preview', { p_party })`:
- Party not found / ended → friendly message + Home button.
- Not signed in → the route guard sends them to `/login?next=/invite/<id>`, which opens on Create account (7.2) and returns here afterwards.
- `viewer_is_subscribed = false` → **non-subscriber screen**: "<Host> invited you to watch <Match> together." Explain that a subscription is needed to join; **Subscribe & join** opens `SubscribeModal` → Yes → `mock_subscribe()` → `join_party()` → lobby or room. Friendly, not pushy.
- Subscribed → "Pick your side" + **Join party** → `rpc('join_party', { p_party, p_team })` → lobby or room depending on status.
- `viewer_member_status = 'removed'` → "The host removed you from this party."

### 8.6 Watch Party Room (`/party/:partyId`) — layout
Desktop (≥ 1024 px): video column ~65% (player, reaction bar, participant strip) + side panel ~35% with tabs **Chat · Timeline · Polls · People**.
Mobile: video pinned at top; tabs below; chat input sticky at bottom.

Guard: if the viewer is not a joined member → redirect to `/invite/:partyId`. If party `status = 'ended'` → "Party ended" screen with a recap (final score at end position, poll leaderboard).

### 8.7 Solo Watch (`/watch/:matchId`)
Same player component with the viewer controlling their own playback (state kept locally, not in DB): live mode with rewind window and Go Live; replay with full seek bar and play/pause. Right side: Timeline tab only (read-only, no Ask Gaffer) + a prominent **Start a Watch Party** card ("Watch with friends and ask Gaffer anything"). This page exists so evaluators see the "live" concept before parties.

---

## 9. Video player & playback sync

### 9.1 YouTube player
- Load `https://www.youtube.com/iframe_api` once (singleton promise in `useYouTubePlayer`).
- `new YT.Player(el, { videoId, playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: window.location.origin } })`.
- **Click shield**: a transparent absolutely-positioned div over the iframe so clicks never reach YouTube (clicking a YouTube iframe toggles play/pause even with `controls: 0`). All interaction goes through our overlay controls.
- **Autoplay policy**: browsers block autoplay with sound. On first load show a full-player overlay: big "▶ Join the stream" (party) / "▶ Watch live" (solo) button. On click: `playVideo()`, `unMute()`, `setVolume(80)`, then start the sync loop. Until clicked, still render the scorebug and timeline at the correct position.
- `onError` (codes 2, 5, 100, 101, 150): show "This video can't be played here" with the YouTube link; log it.
- Fullscreen: our button calls `requestFullscreen()` on the player **container** (so overlays and reactions remain visible), not the iframe.
- Volume slider + mute button use `setVolume` / `mute` / `unMute`.

### 9.2 Live mode (Argentina v France — a looping broadcast)
Use `src/lib/matchTime.js`:
- `liveEdge(match, serverNow)` = `loop.start + ((serverNow − LIVE_EPOCH) mod (loop.end − loop.start))`. Every viewer in the world is at the same live point.
- Viewers can rewind anywhere in `[loop.start, liveEdge]` and can never go past the live edge.
- **Loop wrap**: when the live edge jumps from near `loop.end` back to `loop.start`, any viewer behind live would now be "ahead" of live. Detect wrap (`edge < previousEdge − 60`), set the viewer to live (delay 0) and show a toast: "The broadcast restarted from kick-off." In a party, only the host's client writes `live_delay_s = 0`; guests' clamping covers the gap.

**Seek bar (`LiveSeekBar`)**: track spans `loop.start → loop.end`. Filled from start to the live edge; the region after the edge is visibly locked (diagonal stripes, `cursor: not-allowed`); thumb at current position; small period markers (HT, FT 90, ET, Pens) from `period_starts`. Label: `-MM:SS behind live` (hidden when < 5 s behind). **Go Live** button (red dot) appears when behind.

### 9.3 Replay mode (Betis v Barcelona)
- Range `[period_starts["1"] − 5, period_ends["2"]]`. Full seek bar with goal markers (⚽) at goal `video_time`s, play/pause, ±10 s buttons. Badge: **Full Time**.

### 9.4 Server clock (do this — client clocks differ by seconds)
```js
// src/lib/serverClock.js
let offset = 0; // serverTime - localTime, in seconds
export async function syncServerClock(supabase) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now() / 1000;
    const { data } = await supabase.rpc('get_server_time');
    const t1 = Date.now() / 1000;
    samples.push({ rtt: t1 - t0, offset: data - (t0 + t1) / 2 });
  }
  offset = samples.sort((a, b) => a.rtt - b.rtt)[0].offset;
}
export const serverNow = () => Date.now() / 1000 + offset;
```
Call on app start and every 60 s. **Every** position calculation uses `serverNow()`, never `Date.now()`.

### 9.5 Party position (the one formula everyone uses)
```js
// src/lib/playback.js
export function partyPosition(party, match, now) {
  if (match.mode === 'live') {
    if (!party.is_playing) return clampToLive(match, party.anchor_position, now);
    return clampToLive(match, liveEdge(match, now) - party.live_delay_s, now);
  }
  // replay
  const start = match.config.period_starts['1'] - 5;
  const end = match.config.period_ends['2'];
  const pos = party.is_playing ? party.anchor_position + (now - party.anchor_time) : party.anchor_position;
  return Math.min(Math.max(pos, start), end);
}
```
(`matchTime.js` helpers take the match **config** object; pass `match.config`.)

**Host actions** (each is one `parties` update that also bumps `playback_version`):

| Action | Live mode update | Replay mode update |
|---|---|---|
| Seek to `t` | `live_delay_s = edge − clamp(t)`; if paused also `anchor_position = clamp(t)` | `anchor_position = t, anchor_time = now` |
| Go Live | `live_delay_s = 0, is_playing = true` | — |
| Pause | `is_playing = false, anchor_position = current, anchor_time = now` | same |
| Play | `is_playing = true, live_delay_s = max(0, edge − anchor_position)` | `is_playing = true, anchor_time = now` (anchor_position stays) |
| ±10 s | seek(current ± 10) | seek(current ± 10) |
| Jump to event (Timeline, host only) | seek(event.video_time − 8) | seek(event.video_time − 8) |

When the replay reaches `period_ends["2"]`, the host client sets `is_playing = false` and posts a system message "Full time — that's the match!".

### 9.6 Sync loop (`usePlaybackSync`)
- Subscribe to `parties` UPDATE for this party; keep the latest row in context.
- Every 1000 ms (and immediately when `playback_version` changes):
  1. `target = partyPosition(party, match, serverNow())`
  2. `actual = player.getCurrentTime()`
  3. If `|actual − target| > 1.5` → `player.seekTo(target, true)`; show SyncPill "Re-syncing…" (amber) for 1.5 s; else "In sync" (green).
  4. If `party.is_playing` and player state ≠ PLAYING/BUFFERING → `playVideo()`. If not playing and state = PLAYING → `pauseVideo()`.
- Ignore drift checks for 2 s after any seek and while BUFFERING.
- The scorebug, timeline, polls and Gaffer context all read `target` (the authoritative position), not `getCurrentTime()`.
- **Guests** see no transport controls; instead a small note "🎮 <Host> controls playback" next to the SyncPill. They keep volume, mute and fullscreen.

### 9.7 Scorebug
Top-left overlay: `[ARG crest] ARG 2 – 1 FRA [FRA crest] | 80:12` plus period label when relevant (HT, ET, PENS with shootout tally from the last `shootout_kick` event's `data.shootout_after`). Use condensed tabular numerals. Team short codes and colours come from `match.config.teams` (already in `matches.json`). Use coloured circles with initials instead of real crests (no logo assets).

---

## 10. Chat, reactions & presence

### 10.1 Chat (`useChat`)
- On room load: fetch the last 100 messages (`order by created_at`), join author display names/colours from a members map.
- Subscribe to `messages` INSERT and UPDATE for this party (UPDATE handles flagging).
- **Send**: insert `{ party_id, user_id, body, event_id, video_time: <current authoritative position> }`. Show optimistically, reconcile on INSERT echo. If the insert fails because the user is muted → toast "The host has muted you in chat."
- After a successful insert, if the body matches `/@gaffer\b/i` → call the `gaffer` Edge Function (Section 12) and broadcast `gaffer_thinking`.
- If `settings.ai_moderation` is on → fire-and-forget call to `moderate-message` with the message id (Section 15.2).
- Enter sends, Shift+Enter newline, 1000-char limit, auto-scroll unless the user has scrolled up (then show "New messages ↓" pill).

### 10.2 Message rendering
| Kind | Look |
|---|---|
| User message | Avatar (colour circle + initial), name, team-colour ring, time, body. `@Gaffer` and `@Name` mentions rendered as highlighted chips. |
| Gaffer message | Distinct card: Gaffer avatar (whistle or tactics-board icon), accent left border. Top: context chip "About: 67' Goal disallowed" (from `meta.about_label`; clicking opens the Timeline tab and highlights that event). Body: the answer. Footer chips: rule (e.g. "Law 11 – Offside") and a subtle source label: `data` → "From match data", `likely` → "Likely explanation", `general` → "General rule". |
| Gaffer thinking | Ephemeral row "Gaffer is analysing…" with animated dots, shown to everyone on `gaffer_thinking` broadcast, removed when a gaffer message with `meta.reply_to` = that request arrives (timeout 20 s → "Gaffer couldn't answer that one — try again"). |
| System message | Centred, small, muted text (joins, poll results, full time). |
| Flagged message | Non-hosts: collapsed row "Message hidden by moderation". Host: same row + "Show anyway" (calls `unflag_message`) and the reason. |

Hover actions on user messages: Reply (quotes it), Report (calls `report_message`).

### 10.3 Mention autocomplete
Typing `@` opens a small menu: **Gaffer** first (with "AI match expert" subtitle), then joined members. Selecting inserts `@Gaffer ` / `@Name `.

### 10.4 Reactions
Reaction bar under the video: ⚽ 🔥 😱 😂 👏 🟨 🟥. Click → broadcast `reaction { emoji, userId }` and render locally. Every client renders received reactions in `ReactionOverlay`: emoji floats up from a random x near the bottom of the player over ~2.5 s, fading out (CSS keyframes). Throttle to 1 reaction / 300 ms per user. Not persisted.

### 10.5 Presence
Track on the party channel: `{ userId, displayName, avatarColor, team }`. Participant strip under the video shows joined members (online ones full opacity with a green dot, offline dimmed). Typing indicator via `typing` broadcast ("Riya is typing…"), expires after 3 s.

---

## 11. Match Timeline panel

- Data: `match_events` for this match with `importance = 'key'`, loaded once via `useMatch` (cache in memory).
- Visible list = events with `video_time ≤ position` (authoritative party position). This is the anti-spoiler rule and applies to **both** modes. In **replay** mode only, a toggle "Show full match" reveals all events (greyed for future ones).
- Order: newest first. A newly revealed event slides in with a 3 s highlight; if the Timeline tab isn't active, show an unread count badge on the tab.
- Event row: minute (`clock`), icon by type (⚽ goal, 🟨 yellow card, 🟥 red card, 🔁 substitution, 🚩 offside, ✋ handball, 📺 VAR, ⚠️ penalty awarded, 🎯 shootout kick, ⏱ period start/end), team colour bar, `description`, score chip on goals.
- **Ask Gaffer** button on every event (except period start/end): switches to the Chat tab, prefills the input with `@Gaffer explain this`, and shows a removable context chip above the input ("📎 80' Mbappé penalty"). Sending includes `event_id`.
- **Jump to** button — host only, and replay mode or live mode (within the rewind window): seek to `video_time − 8`.
- Footer: data credit from `match.config.data_credit` (StatsBomb attribution for the final).

---

## 12. @Gaffer — the AI match companion (most important feature)

### 12.1 Flow
1. User sends a chat message containing `@Gaffer` (optionally with an attached `event_id`).
2. Client inserts the message, broadcasts `gaffer_thinking { requestId: messageId }`, and calls:
   `supabase.functions.invoke('gaffer', { body: { party_id, message_id } })`.
3. Edge Function `gaffer`:
   1. Verify the caller: create a Supabase client with the request's `Authorization` header; `auth.getUser()`; confirm membership (`is_party_member` RPC or select on `party_members`).
   2. **Rate limit** (service-role client on `ai_requests`): max 6 Gaffer calls per user per minute and 20 per party per minute. Over the limit → 429; the client shows "Gaffer needs a breather — try again in a few seconds."
   3. Load the message (ignore the client's copy of body/event), the party row, the match row and all events for the match.
   4. **Compute the position server-side** with the shared `partyPosition()` and `Date.now()/1000` (never trust a position sent by the client — this is what prevents spoilers).
   5. Build the context (12.2) and call Claude (12.3).
   6. Validate the JSON response; run the spoiler check in live mode (12.4).
   7. Insert the reply with the **service role**: `{ party_id, author_type: 'gaffer', body: answer, reply_to: message_id, meta: { reply_to: message_id, about_event_id, about_label, rule, confidence } }`. `about_label` = `"<clock> <short type/player>"` built from the event.
   8. Return `{ ok: true }`.
4. Every client receives the INSERT via realtime and replaces the "analysing…" row.

### 12.2 Context sent to Claude (user turn)
Build a compact text block (keep it under ~6k tokens):

```
MATCH: Argentina vs France — FIFA World Cup 2022 Final (LIVE)
CURRENT MATCH TIME: 79:42 (2nd half)        SCORE: Argentina 2–0 France
LINEUPS & SHAPE: <starting formations + XIs from config.lineups; current formation per team = latest tactical_shift ≤ position>
SUBSTITUTIONS SO FAR: <list>
CARDS SO FAR: <list>
KEY EVENTS SO FAR: <every key event ≤ position: "clock — description">
RECENT DETAIL (last 4 minutes): <detail events with video_time in [position−240, position]: "clock — description + useful data fields (zone, victim, xg)">
ATTACHED EVENT (the user is asking about this): <full event JSON, if event_id>
RECENT CHAT (oldest→newest): <last 8 non-flagged messages, "Name: text"; include Gaffer's own recent answers>
ASKER: Riya (supports Argentina)
QUESTION: why was that a penalty?
```

- **Live mode**: include only events with `video_time ≤ position`. Never send future events.
- **Replay mode**: include all key events (label each `[already seen]` / `[later in the match]` relative to position) and detail events within ±4 minutes of the position, and add the `full_time_stats` from config.
- If the question has no attached event and uses "that/this/just now", the recent-detail block is what lets Claude identify the moment; instruct it (below) to say which moment it's answering about.

### 12.3 Claude call
```js
// supabase/functions/_shared/claude.js
export async function callClaude({ system, user, maxTokens = 450 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: Deno.env.get('GAFFER_MODEL') ?? 'claude-haiku-5-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}
```
Parse: strip ```` ```json ```` fences, `JSON.parse`. On parse failure, use the raw text as `answer` with `confidence: 'general'`. On API failure, insert a gaffer message "I couldn't analyse that just now — ask me again in a moment." (still with `reply_to`, so the thinking row clears).

**System prompt (use verbatim, filling the `{…}` parts):**

```
You are Gaffer, the AI match companion inside Dream Watch, a watch-party app where friends watch football together and chat. Fans tag you in the group chat to ask what's happening on the pitch.

YOUR JOB
Explain match situations the way a knowledgeable friend in the group would: refereeing decisions (offside, handball, fouls, cards, penalties, VAR), tactics (substitutions, formation changes, game state), players and stats.

HOW TO ANSWER
- 2–4 short sentences, about 80 words maximum, unless asked for more. Plain language; explain jargon in a few words.
- Start by naming the moment you're answering about when the question refers to "that", "this" or "just now" (e.g. "Thuram's yellow at 87' was for…"). Use the ATTACHED EVENT if present; otherwise pick the most relevant event in RECENT DETAIL. If you can't tell which moment they mean, say which one you're assuming.
- Ground every factual claim in the MATCH DATA provided. Never invent events, minutes, players, statistics, quotes or referee statements.
- For refereeing questions, name the relevant IFAB Law of the Game (e.g. Law 11 – Offside; Law 12 – Fouls and Misconduct, which covers handball and cards; Law 14 – The Penalty Kick; Law 3 – The Players, for substitutions) and explain the specific criterion that applies.
- The data records WHAT happened, not always WHY. If the reason isn't in the data, say so plainly and give the most likely explanations under the Laws, clearly framed as likely rather than confirmed.
- For tactical questions, use formations, substitutions, the score and the time remaining to explain the likely intent.
- Stay neutral between teams. Light, friendly banter is fine; never insult players, fans or the asker.
- If the question isn't about this match or football, give a one-line friendly redirect.
- Never give betting or gambling advice or odds.

{MODE_RULES}

OUTPUT
Return ONLY a JSON object, no other text:
{"answer": "<your reply>", "about_event_id": "<id of the event you explained, or null>", "rule": "<e.g. 'Law 11 – Offside', or null>", "confidence": "data" | "likely" | "general"}
- "data": the answer is directly supported by the match data.
- "likely": the event is in the data but the reason is your best explanation.
- "general": a general rules/football explanation not tied to a specific recorded event.
```

`{MODE_RULES}` for **live**:
```
LIVE MATCH RULES (critical)
This match is being watched live. The current match time is {clock}. Behave as if nothing after this moment has happened yet. Do not reveal or hint at later goals, cards, substitutions, extra time, penalties, the final score or the winner, even if you remember this match from your training. If asked who will win or what happens next, give an honest, uncertain take based only on the data so far, or say you'll all find out together.
```
`{MODE_RULES}` for **replay**:
```
REPLAY RULES
This match has finished and the group is rewatching it together. You may discuss the whole match, including the result. The group is currently at {clock}; when a question is ambiguous, prefer the moments around that time.
```

### 12.4 Spoiler check (live mode only)
After parsing, scan `answer` (case-insensitive) for:
- Any scoreline string (`3–2`, `3-2`, `3–3`, `4–2`, …) taken from `score_after` of goal events **after** the position.
- Names of goal scorers combined with "scores"/"goal"/"hat-trick" for goals after the position.
- If position is before period 3: "extra-time goal", "extra-time winner", "extra-time equaliser" (conditional phrasing like "if it stays level it goes to extra time" is fine and must not be blocked).
- If position is before period 5: "penalty shootout", "shootout", "on penalties".
- Always: "won the world cup", "wins the world cup", "world champions", "lifted the trophy", "golden boot".

If triggered, retry once with an extra system line: "Your previous answer revealed events after {clock}. Answer again using only events up to {clock}." If it still triggers, reply: "No spoilers from me — we'll find out together! Ask me about anything up to now." Log the incident.

### 12.5 Example Q&As to test (live mode, Argentina v France)
| Position | Question | Good answer contains |
|---|---|---|
| 22:30 | "@Gaffer why was that a penalty?" | Dembélé's foul on Di María inside France's area at 21'; Law 12/14; direct free-kick offence inside own area → penalty. |
| 41:30 | "@Gaffer why did Deschamps make two subs before half-time?" | Giroud and Dembélé off for Thuram and Kolo Muani at 41'; France 2–0 down and struggling; change of energy/pace; no mention of later goals. |
| 87:30 | "@Gaffer why did Thuram get booked?" | Simulation (dive) in the box at 87'; Law 12 unsporting behaviour → yellow. |
| 90+6 | "@Gaffer Giroud isn't even playing, how did he get a yellow?" | Off-the-pitch/bench misconduct is still cautionable under Law 12; the data shows bad behaviour, not a foul. |
| 30:00 | "@Gaffer who wins this?" | No spoiler; uncertain take from data so far. |

---

## 13. AI predictions & polls

### 13.1 Generation (`generate-poll` Edge Function)
- Triggered by: (a) the **host's client** automatically when the party is live, no poll is open, and at least 6 minutes of match time have passed since the last poll (first poll ~2 minutes after start); (b) the host's "Ask Gaffer for a poll" button in the Polls tab (guests too if `settings.guests_can_poll`).
- Verify caller is the host (or guests allowed); rate limit 1 per party per 60 s.
- Compute position server-side. Send Claude the same match context as 12.2 (events up to position only, **in both modes**, so polls are genuine predictions) plus this instruction:

```
Create ONE fun prediction poll for friends watching this match right now. Choose exactly one kind:
- goal_in_window: "Will there be a goal in the next N minutes?" (options yes/no)
- card_in_window: "Will anyone be booked in the next N minutes?" (yes/no)
- next_goal_team: "Who scores next (within N minutes)?" (home team / away team / none)
- next_card_team: "Which team gets the next card (within N minutes)?" (home / away / none)
- player_scores_in_window: "Will <player currently on the pitch> score in the next N minutes?" (yes/no)
- shootout_kick_scored: only during a penalty shootout: "Will the next penalty go in?" (yes/no)
N must be between 5 and 15 and must not run past the end of the current period.
Make the question specific and lively, referencing the current situation (score, momentum, recent events). No betting language.
Return ONLY JSON: {"kind": "...", "question": "...", "window_minutes": 10, "player": "<name or null>"}
```
- The function then **builds canonical options itself** (never trust model options):
  - yes/no kinds → `[{id:'yes',label:'Yes'},{id:'no',label:'No'}]`
  - team kinds → `[{id:<home>,label:<home>},{id:<away>,label:<away>},{id:'none',label:'No goal' | 'No card'}]`
- Times: `opens = position`, `votes_close = position + 90`, `closes = min(position + window_minutes*60, current period end)`; for `shootout_kick_scored`, `closes = position + 75`.
- Insert into `polls` (`resolve_rule = { kind, player }`), then insert a gaffer chat message "🗳️ New poll: <question> — vote in the Polls tab".

### 13.2 Voting & resolution
- Poll card: question, options with live vote bars (percentages + avatars of voters), countdown to `votes_close` ("Voting closes in 0:52") then to `closes` ("Result at 34'"), label "Generated by Gaffer".
- Voting UI disabled after `votes_close_at_video_time` (relative to the authoritative position) or if already voted.
- **Resolution**: the host's client watches open polls; when `position ≥ closes_at_video_time` → `rpc('resolve_poll', { p_poll })`. The SQL computes the answer from `match_events`, marks the poll resolved and posts a system message. Every client updates via realtime.
- If the host seeks to before `opens_at_video_time`, or a live loop wrap happens, the host client calls `rpc('void_poll', { p_poll })` for each open poll.
- Resolved card shows the correct option highlighted and "✓ Riya, Kabir got it right".

### 13.3 Leaderboard
Computed client-side: +10 per correct vote across resolved polls in this party. Shown under the polls list and on the party-ended recap.

---

## 14. Testing with more than one person

There are no demo accounts, bots or "open as a friend" shortcuts. Every participant is a real signed-up, subscribed user. Because tabs in the same browser share one login (7.3), a second user needs an **incognito/private window**, another browser, or another device.

Make this easy to discover:
- **`TestingAloneHint`** card in the Lobby, and as a dismissible banner at the top of the Room's People tab while the host is the only joined member:
  > **Testing alone?** Copy the invite link, open it in an incognito window, create a second account with any email, subscribe, and join. Put the windows side by side to see sync, chat and Gaffer in real time.
  with a **Copy invite link** button.
- The Room header always has a **Share** button that copies the invite link.
- Everything AI-related (Gaffer, the timeline, polls) works fine with a single person, so a solo evaluator can still test the AI features fully.

---

## 15. Host controls & moderation

### 15.1 Host controls (People tab)
- Member list: avatar, name, Host/Guest badge, team supported, Premium badge, online dot, status.
- Host-only per member (not on self): **Mute in chat** / Unmute (`party_members.muted`), **Remove from party** (confirm dialog → `status = 'removed'`). The removed user's client gets the UPDATE → full-screen "The host removed you from this party" → Home.
- Party settings (host): AI moderation on/off, Guests can create polls (`parties.settings`).
- **End party for everyone** (red, confirm) → `status = 'ended', ended_at = now(), is_playing = false`. All clients show the recap screen: match and score at the end position, poll leaderboard, number of Gaffer questions, "Back to Home".
- Guests see the same list without action buttons.

### 15.2 AI moderation (`moderate-message` Edge Function)
- Called fire-and-forget by the sender's client after each message insert, when `settings.ai_moderation` is on.
- Verify caller is the message author; skip messages under 3 characters; rate limit 30 per user per minute.
- Claude prompt (small, `max_tokens: 60`):
```
You moderate a friendly football watch-party chat. Banter, rivalry, frustration at players or referees, and mild swearing about the game are ALLOWED. Flag only: harassment or insults aimed at people in the chat, hate speech or slurs, threats, sexual content, sharing personal information (phone numbers, addresses), or spam.
Message: """{body}"""
Return ONLY JSON: {"flag": true|false, "reason": "harassment"|"hate"|"threat"|"sexual"|"personal_info"|"spam"|null}
```
- If flagged → service-role update `flagged = true, flag_reason = reason`. Realtime UPDATE collapses it for everyone (host can "Show anyway").
- Trade-off to mention in the README: moderation runs just after posting (a message may be visible for ~1–2 s) to keep chat instant; a production version would pre-screen.
- Manual **Report** (any member) uses `report_message` and works even with AI moderation off.

---

## 16. Seed script (`supabase/seed/seed.js`)

Loads **match data only** — no users. Run locally with Node 18+: `node supabase/seed/seed.js`. Must be idempotent (safe to re-run).

```js
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import 'dotenv/config';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const matches = JSON.parse(fs.readFileSync('data/matches.json', 'utf8'));

for (const [i, m] of matches.entries()) {
  await admin.from('matches').upsert({
    id: m.id, mode: m.mode, title: m.title, competition: m.competition,
    youtube_id: m.youtube_id, config: m, sort_order: i,
  });
  const events = JSON.parse(fs.readFileSync(`data/${m.events_file}`, 'utf8'));
  await admin.from('match_events').delete().eq('match_id', m.id);
  const rows = events.map((e) => ({
    id: e.id, match_id: m.id, period: e.period, elapsed_in_period_s: e.elapsed_in_period_s ?? null,
    video_time: e.video_time, clock: e.clock, type: e.type, importance: e.importance, team: e.team,
    player: e.player, description: e.description, score_after: e.score_after, data: e.data ?? {},
    approximate: !!e.approximate,
  }));
  for (let j = 0; j < rows.length; j += 200) {
    const { error } = await admin.from('match_events').insert(rows.slice(j, j + 200));
    if (error) throw error;
  }
  console.log(`${m.id}: ${rows.length} events`);
}
```
Check every Supabase call's `error` and stop on failure.

---

## 17. Edge Functions — shared conventions

- Import Supabase in Deno: `import { createClient } from 'npm:@supabase/supabase-js@2';`
- Two clients per request: `userClient` (anon key + the request's `Authorization` header) to identify the caller and respect RLS; `adminClient` (service role) for writes to `messages` (gaffer/system), `polls`, `ai_requests`, and flag updates.
- CORS: handle `OPTIONS` and add `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type` to every response (`_shared/cors.js`).
- Keep `verify_jwt` enabled (default); the client calls via `supabase.functions.invoke`, which sends the user's token.
- Shared `_shared/matchTime.js` and a `partyPosition()` copy so server and client compute positions identically.
- Log errors with `console.error` (visible in Supabase dashboard → Edge Functions → Logs). Never log the API key or full prompts with user emails.
- Deploy: `supabase functions deploy gaffer generate-poll moderate-message`.

---

## 18. Deployment checklist

1. Create a Supabase project. Run `0001_init.sql` (CLI `supabase db push` or SQL editor).
2. Auth → Providers → Email: enabled, **Confirm email OFF**. Auth → URL configuration: Site URL = the Vercel URL.
3. `supabase secrets set ANTHROPIC_API_KEY=... GAFFER_MODEL=claude-haiku-5-5`.
4. Deploy the three Edge Functions.
5. Run the seed script (loads the two matches and their events).
6. Vercel: import the repo, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, deploy. Confirm `vercel.json` rewrites so `/party/<id>` deep links work on refresh.
7. Test the whole flow on the **deployed** URL in two browser windows (Section 20). Also test on a phone.
8. Check that both YouTube videos play in the embed on the deployed domain (from India).

---

## 19. Build order (one day) with acceptance criteria

| # | Milestone | Est. | Done when |
|---|---|---|---|
| 1 | Scaffold Vite + React + router; port Claude Design screens as static components with mock data | 1.5 h | All pages render with the design's look; responsive layout works. |
| 2 | Supabase schema, RLS, RPCs, seed, sign up / sign in, Subscribe button + gate + modal | 1 h | A new email can sign up and is unsubscribed; clicking a match opens the subscribe modal; Yes subscribes and continues to the match; matches + events in DB. |
| 3 | `useYouTubePlayer`, click shield, Join overlay, server clock, live edge + LiveSeekBar, replay seek bar, scorebug, solo Watch page | 1.5 h | Two tabs on `/watch/arg-fra-2022-final` show the same live moment (±1.5 s); can rewind but not pass live; Go Live works; scorebug matches the video. |
| 4 | Create party modal (check_invites), lobby + Testing alone hint, invite page, join, start party, room shell, host-controlled sync | 2 h | Host in a normal window and a second account in an incognito window stay in sync through seek, pause, play, Go Live. A brand-new account opening the invite link signs up, subscribes and joins. |
| 5 | Chat, reactions, presence, timeline with Ask Gaffer prefill | 1.5 h | Messages and reactions appear in both windows instantly; timeline never shows future events. |
| 6 | Gaffer Edge Function + UI | 1.5 h | The five test questions in 12.5 get correct, spoiler-free answers in < 5 s; thinking state shows for everyone. |
| 7 | Polls: generate, vote, resolve, leaderboard | 1 h | A poll appears, both windows vote, it resolves correctly from match data. |
| 8 | Host controls, moderation, ended recap | 1 h | Mute/remove/end work across windows; an abusive test message gets hidden; normal banter isn't. |
| 9 | Deploy, test on deployed URL + phone, polish, README | 1 h | Section 20 checklist passes on production. |

**If time runs short, cut in this order:** AI moderation (keep manual Report) → automatic poll triggering (keep the button) → typing indicator → solo Watch page polish. **Never cut:** sign-up + subscribe flow, sync, Gaffer, timeline, the Testing alone hint.

---

## 20. Test checklist (run on the deployed URL)

- [ ] A new email can sign up and use the app immediately (no confirmation email); sign out and sign in work; a refresh keeps you signed in.
- [ ] Unsubscribed: header shows Subscribe; clicking a match, Watch or Start Watch Party opens the modal; Cancel does nothing; Yes subscribes, shows Premium, and continues to the match.
- [ ] Home hero shows the correct live score/clock; Betis–Barça shows Full Time.
- [ ] Live: cannot seek past the live edge; "-MM:SS behind live" and Go Live work; reload keeps you at live.
- [ ] Replay: seek anywhere, play/pause, goal markers.
- [ ] Create party: a subscribed account's email → "Subscribed ✓", an unsubscribed account's email → "Not subscribed yet", a random email → "No account yet".
- [ ] Invite link in an incognito window → Create account (pre-selected) → back to the invite → Subscribe & join → modal → joins the party.
- [ ] The Testing alone hint shows in the Lobby and copies the link.
- [ ] Host seek/pause/play/Go Live propagates to guests within ~1–2 s; guests have no transport controls; SyncPill shows status.
- [ ] Chat + reactions + presence in real time; mention autocomplete inserts @Gaffer.
- [ ] Timeline reveals events exactly as they happen on video; Ask Gaffer attaches the event.
- [ ] Gaffer answers the 12.5 questions correctly; "who wins?" in live mode gives no spoiler; replay mode can discuss the result.
- [ ] Gaffer rate limit message appears after rapid-fire questions.
- [ ] Poll generated, voted on from both windows, resolved correctly, leaderboard updates.
- [ ] Host mutes the guest → their send fails with a toast; host removes the guest → they see the removed screen.
- [ ] AI moderation hides a clearly abusive message; host can Show anyway; normal banter isn't flagged.
- [ ] End party → recap in both windows.
- [ ] Mobile layout: video pinned, tabs usable, chat input not hidden by the keyboard.
- [ ] No API key in the browser bundle (search the built JS for `sk-ant`).

---

## 21. Gotchas (read before debugging)

1. **YouTube embedding**: if a video shows "unavailable", the uploader disabled embedding or it's region-blocked. Test both IDs on the deployed domain early.
2. **Autoplay**: video won't start with sound without a user click → the Join overlay is mandatory.
3. **Clicks on the iframe** pause YouTube even with `controls: 0` → keep the click shield.
4. **Never call player methods before `onReady`.** Queue calls until ready.
5. **React StrictMode** runs effects twice in dev → make player creation and channel subscription idempotent and clean them up (`player.destroy()`, `supabase.removeChannel(ch)`).
6. **Client clocks are wrong by seconds** → always use `serverNow()`.
7. **RLS recursion**: policies on `party_members` that query `party_members` recurse → that's why `is_party_member()` is `security definer`.
8. **Realtime needs the publication** (6.6) and RLS select permission for the subscriber, or no events arrive.
9. **Realtime filters** support one column equality: use `party_id=eq.<id>` (and `id=eq.<id>` for `parties`).
10. **Tabs share one login.** A second tab in the same browser is the same user, so it will look like you joined twice. Test a second user in an incognito window or another browser.
11. **Edge Function CORS**: missing `OPTIONS` handling shows up as a generic "Failed to send a request" from `functions.invoke`.
12. **Spoilers**: the server computes position and filters events; the client must never send events or position to Gaffer.
13. **Vite env vars** must start with `VITE_` to reach the browser, and nothing secret may start with `VITE_`.
14. **StatsBomb attribution**: keep "Event data: StatsBomb Open Data" visible on the final's timeline footer.

---

## 22. README.md (write this at the end)

Include: one-paragraph pitch (the fan problem: friends watching apart on separate streams + a group call; Dream Watch puts the party inside the app, synced, with an AI expert in the group); live URL; **"How to test in 3 minutes"** (sign up with any email → Subscribe → Start Watch Party on the live match → copy the invite link → open it in an incognito window → create a second account → Subscribe & join → in either window ask `@Gaffer why was that a penalty?` → vote on a poll); architecture overview (React + Supabase Realtime + Edge Functions + Claude; how live is simulated with a looping broadcast and server-clock sync; how production would use a licensed live data feed and stream timestamps instead of offsets); AI features (Gaffer Q&A grounded in event data with spoiler protection, AI polls auto-resolved from data, AI moderation); known limitations (simulated live, mock subscription with no payment, minute-level data for Betis–Barça, moderation after posting); credits (StatsBomb Open Data; match videos embedded from the official FIFA and FC Barcelona YouTube channels).
