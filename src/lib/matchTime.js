// Shared match-time helpers. Pure functions over a match *config* (the object from
// data/matches.json). This file is copied verbatim to supabase/functions/_shared/
// by `npm run sync-shared`, so it must not touch browser or Deno globals.

export const DEFAULT_LIVE_EPOCH = 1793491200; // 2026-11-01T00:00Z
let liveEpoch = DEFAULT_LIVE_EPOCH;

export function setLiveEpoch(value) {
  const v = Number(value);
  if (Number.isFinite(v) && v > 0) liveEpoch = v;
}

export function periods(config) {
  return Object.keys(config.period_starts).map(Number).sort((a, b) => a - b);
}

export function lastPeriod(config) {
  const ps = periods(config);
  return ps[ps.length - 1];
}

// Video time of an event. Prefer period offset + elapsed so one edit to
// period_starts re-aligns a whole period.
export function eventVideoTime(config, e) {
  const start = config.period_starts[String(e.period)];
  if (e.elapsed_in_period_s != null && start != null) return Number(start) + Number(e.elapsed_in_period_s);
  return Number(e.video_time);
}

// Sorted by video time; events at the same second keep their source order (`seq`).
export function normalizeEvents(config, events) {
  return events
    .map((e) => ({ ...e, video_time: eventVideoTime(config, e) }))
    .sort((a, b) => a.video_time - b.video_time || (a.seq ?? 0) - (b.seq ?? 0));
}

// Running team stats at video time t (from the latest event's `stats_after`), or null.
export function statsAt(events, t) {
  let stats = null;
  for (const e of events) {
    if (e.video_time > t) break;
    const s = e.stats_after ?? e.data?.stats_after; // seeded rows keep it inside `data`
    if (s) stats = s;
  }
  return stats;
}

// The seekable range of the video: the loop for live, kick-off − 5 s → final whistle for replay.
export function playbackRange(config) {
  if (config.mode === 'live' && config.loop) return { start: config.loop.start, end: config.loop.end };
  return { start: config.period_starts['1'] - 5, end: config.period_ends[String(lastPeriod(config))] };
}

// ---------- Live (looping broadcast) ----------

export function liveEdge(config, now) {
  const { start, end } = config.loop;
  const len = end - start;
  const d = (((now - liveEpoch) % len) + len) % len;
  return start + d;
}

export function clampToLive(config, t, now) {
  return Math.min(Math.max(t, config.loop.start), liveEdge(config, now));
}

export function behindLive(config, t, now) {
  return Math.max(0, liveEdge(config, now) - t);
}

// ---------- Match clock ----------

const PERIOD_PHASE = { 1: '1ST HALF', 2: '2ND HALF', 3: 'EXTRA TIME · 1ST', 4: 'EXTRA TIME · 2ND', 5: 'PENALTIES' };
const PERIOD_LABEL = { 1: '1st half', 2: '2nd half', 3: 'Extra time, 1st half', 4: 'Extra time, 2nd half', 5: 'Penalty shootout' };

function breakPhase(config, p) {
  const has = (n) => config.period_starts[String(n)] != null;
  if (p === 1) return { phase: 'HALF-TIME', short: 'HT' };
  if (p === 2) return has(3) ? { phase: 'END OF 90', short: 'FT 90' } : { phase: 'FULL TIME', short: 'FT' };
  if (p === 3) return { phase: 'ET HALF-TIME', short: 'ET HT' };
  if (p === 4) return has(5) ? { phase: 'END OF EXTRA TIME', short: 'AET' } : { phase: 'FULL TIME', short: 'FT' };
  return { phase: 'FULL TIME', short: 'FT' };
}

export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// Converts a video offset to what a broadcast scorebug would show.
// Returns { period, inPlay, phase, periodLabel, clock: 'MM:SS', minute: "80'" | "45+2'" }.
export function videoToMatchClock(config, t) {
  const ps = periods(config);
  const first = config.period_starts['1'];
  if (t < first) {
    return { period: 0, inPlay: false, phase: 'PRE-MATCH', periodLabel: 'Pre-match', clock: '00:00', minute: "0'" };
  }
  let p = ps[0];
  for (const n of ps) if (config.period_starts[String(n)] <= t) p = n;
  const start = config.period_starts[String(p)];
  const end = config.period_ends[String(p)];
  const base = config.period_base_minute?.[String(p)];
  const len = config.period_length_min?.[String(p)];

  if (p === 5 || base == null) {
    const inPlay = t <= end;
    return {
      period: p, inPlay, phase: inPlay ? PERIOD_PHASE[p] ?? 'PENALTIES' : 'FULL TIME',
      periodLabel: PERIOD_LABEL[p] ?? 'Penalties', clock: 'PENS', minute: 'Pens',
    };
  }
  if (t <= end) {
    const elapsed = t - start;
    const total = base * 60 + elapsed;
    const stoppage = len != null && elapsed > len * 60;
    const minute = stoppage
      ? `${base + len}+${Math.ceil((elapsed - len * 60) / 60)}'`
      : `${Math.floor(total / 60) + 1}'`;
    return { period: p, inPlay: true, phase: PERIOD_PHASE[p], periodLabel: PERIOD_LABEL[p], clock: fmtClock(total), minute };
  }
  const b = breakPhase(config, p);
  const atMinute = base + (len ?? 0);
  return { period: p, inPlay: false, phase: b.phase, short: b.short, periodLabel: b.phase.toLowerCase(), clock: fmtClock(atMinute * 60), minute: `${atMinute}'` };
}

// ---------- Events ----------

export function getEventsUpTo(events, t) {
  return events.filter((e) => e.video_time <= t);
}

export function recentEvents(events, t, windowS = 240) {
  return events.filter((e) => e.video_time <= t && e.video_time > t - windowS);
}

// Score at video time t: { home, away, shootout: { home, away } | null }.
export function scoreAt(config, events, t) {
  let home = 0;
  let away = 0;
  let shootout = null;
  for (const e of events) {
    if (e.video_time > t) break;
    if (e.type === 'goal' && e.score_after) {
      home = Number(e.score_after[config.home] ?? home);
      away = Number(e.score_after[config.away] ?? away);
    }
    const so = e.type === 'shootout_kick' && e.data?.shootout_after;
    if (so) shootout = { home: Number(so[config.home] ?? 0), away: Number(so[config.away] ?? 0) };
  }
  return { home, away, shootout };
}
