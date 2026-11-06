# Dream Watch

Football fans who can't be in the same room end up watching on separate streams a few seconds apart, with a group chat on the side and a goal spoiled by whoever's stream is ahead. Dream Watch puts the party inside the streaming app: everyone watches the same moment, chats and reacts over the video, votes on prediction polls, and can tag **@Gaffer**, an AI match expert who explains offsides, handballs, cards and tactical changes from real match event data, without spoiling what hasn't happened yet.

**Live URL:** _add after deploying_

## How to test in 3 minutes

1. Sign up with any email (no confirmation email) and click **Subscribe** → **Yes, subscribe**.
2. On the live match (Barcelona v Atlético de Madrid), click **Start Watch Party** → **Create party**. Friends who already have a subscribed account can be invited by email: they get a notification in the header bell.
3. In the lobby, copy the invite link and open it in an **incognito window**. Create a second account, then **Subscribe & join**.
4. Back in the first window, click **Start party**. Both windows move into the room and stay in sync. Try pause, rewind, Go Live.
5. In either window, ask `@Gaffer why was that a penalty?` once the 35' penalty has happened (or use **Ask Gaffer** on any Timeline event). Anyone can pause or rewind; the chat logs who did.
6. Vote on the poll Gaffer drops in the Polls tab. It resolves from match data and the leaderboard updates.

## Architecture

- **React (Vite, JavaScript)** front end on Vercel. Visual design ported from the Claude Design export: Barlow Condensed and Inter, "Night Match" dark palette, Pitch Lime accent.
- **Supabase**: Postgres with row-level security, Auth (email + password), Realtime (one channel per party for row changes, broadcast reactions/typing and presence), and Edge Functions.
- **AI** runs only in Edge Functions (`gaffer`, `generate-poll`, `moderate-message`), never in the browser, using structured JSON outputs. The provider is switchable (`supabase/functions/_shared/llm.js`): **Gemini** (`gemini-3.5-flash`, falling back to `gemini-3.1-flash-lite` when Google reports high demand) when `GEMINI_API_KEY` is set, or **Claude** (`claude-haiku-5-5` via the Anthropic SDK) with `ANTHROPIC_API_KEY`.
- **Simulated live:** the 2022 final plays as a looping broadcast. The live edge is `loop.start + (serverNow − LIVE_EPOCH) mod loopLength`, so every viewer worldwide is at the same point. All clients use the server clock (`get_server_time` RPC) rather than their own.
- **Sync:** playback state lives in one row (`parties`: anchor position/time, live delay, playing flag, version). Any member can change it through the `playback_action` RPC, which also writes the "Riya paused the video" chat log; the host can restrict this to themselves. Every client computes the same position from it with `partyPosition()` and corrects the YouTube player when it drifts more than 1.5 s. The same function runs inside the Edge Functions (`npm run sync-shared` copies it), so Gaffer and polls use a position computed on the server, never one sent by the client.
- **In production** this would use a licensed live data feed and stream timestamps instead of hand-set video offsets.

## Video calls

Party members can turn on their camera and mic in the room. Video tiles appear in the participant strip or over the match picture ("On video"), or can be hidden while audio keeps playing. A speaking glow shows who is talking. The host can stop someone's video, ask a guest to turn theirs on, or turn off guest cameras for the whole party.

Calls are peer-to-peer WebRTC: every participant connects directly to every other one, which suits watch parties of up to about 6 people. The browsers exchange connection details through a Supabase Realtime channel (`call:{partyId}`), so audio and video never pass through our servers. Calls use Google's public STUN server by default. On strict networks (some office Wi-Fi and mobile carriers) a direct connection isn't possible, so set `VITE_ICE_SERVERS` to include a TURN server (see `.env.example`).

## AI features

- **Gaffer Q&A**: grounded in StatsBomb event data up to the party's current moment, names the relevant IFAB Law, and labels each answer as *from match data*, *likely explanation* or *general rule*. In live mode the server only sends past events, and a spoiler check retries or blocks answers that mention later goals, extra time, penalties or the winner.
- **AI prediction polls**: the model writes the question; the server builds the options and time window, and Postgres settles the result from `match_events`, so the model never decides who was right.
- **AI moderation**: flags harassment, hate, threats, sexual content, personal info and spam, while banter is allowed. The host can review and restore. Members can also report messages manually.

## Setup

```bash
npm install
cp .env.example .env            # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
```

1. Create a Supabase project and run `supabase/migrations/0001_init.sql` (`supabase db push` or the SQL editor).
2. **Auth → Providers → Email:** enabled, **Confirm email OFF**. **Auth → URL configuration:** Site URL = your Vercel URL.
3. Put the AI secrets in `supabase/functions/.env` (gitignored; see `.env.example`), e.g. `GEMINI_API_KEY=...`, then run `supabase secrets set --env-file supabase/functions/.env`.
4. `npm run sync-shared && supabase functions deploy gaffer generate-poll moderate-message`
5. Put the event files in `data/` (`arg_fra_events.json`, `betis_barca_events.json`), add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `supabase/seed/.env`, then run `npm run seed`.
6. `npm run dev` locally, or deploy to Vercel with the two `VITE_` variables. `vercel.json` rewrites deep links like `/party/<id>`.

After changing `src/lib/matchTime.js` or `src/lib/playback.js`, run `npm run sync-shared` and redeploy the functions.

## Known limitations

- Live is simulated with a looping full-match video. Subscriptions are a mock flag with no payment.
- The 2022 World Cup final (StatsBomb data) is still seeded but hidden (`"listed": false` in `data/matches.json`) because FIFA's video can't be embedded here. Barcelona v Atlético has no lineups in its config, so Gaffer works from the events alone.
- Betis v Barcelona events come from match reports and are accurate to the minute (marked "≈ minute").
- Moderation runs just after a message is posted, so a message can be visible for 1–2 s before it's hidden. A production version would screen messages before posting.
- Flagged messages are hidden in the UI, but their text can still be read through the API by party members.
- Embedded YouTube videos depend on the uploader allowing embeds in the viewer's region.
- Video calls connect everyone to everyone, which suits small parties only. Without a TURN server, some networks can't connect. The call signalling and the host's "stop video" request use public Realtime broadcast, so a technically minded party member could fake them. A production version would use authorized private channels and a media server (SFU) for larger groups.

## Credits

Event data for the 2022 World Cup final: **StatsBomb Open Data** (free for non-commercial use). Match videos are embedded from the official FIFA and FC Barcelona YouTube channels.
