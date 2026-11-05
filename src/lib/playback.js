// Playback maths shared by the browser and the Edge Functions (copied to
// supabase/functions/_shared/ by `npm run sync-shared`).
//
// A "playback state" has the shape of the playback columns on `parties`:
//   { is_playing, anchor_position, anchor_time, live_delay_s, playback_version }
// Solo viewing keeps the same shape in local state, so both use one formula.

import { clampToLive, liveEdge, playbackRange } from './matchTime.js';

// `match` is a matches row: { mode, config }.
export function partyPosition(party, match, now) {
  const config = match.config;
  if (match.mode === 'live') {
    if (!party.is_playing) return clampToLive(config, Number(party.anchor_position ?? liveEdge(config, now)), now);
    return clampToLive(config, liveEdge(config, now) - Number(party.live_delay_s ?? 0), now);
  }
  const { start, end } = playbackRange(config);
  const anchor = Number(party.anchor_position ?? start);
  const pos = party.is_playing ? anchor + (now - Number(party.anchor_time ?? now)) : anchor;
  return Math.min(Math.max(pos, start), end);
}

export function initialPlayback(match, now) {
  if (match.mode === 'live') {
    return { is_playing: true, anchor_position: liveEdge(match.config, now), anchor_time: now, live_delay_s: 0, playback_version: 0 };
  }
  return { is_playing: true, anchor_position: playbackRange(match.config).start, anchor_time: now, live_delay_s: 0, playback_version: 0 };
}

// Returns the column patch for a host action. Every patch bumps playback_version.
// actions: seek (arg = target video time), goLive, pause, play, skip (arg = ±seconds).
export function playbackPatch(action, party, match, now, arg) {
  const config = match.config;
  const live = match.mode === 'live';
  const current = partyPosition(party, match, now);
  const version = { playback_version: (party.playback_version ?? 0) + 1 };

  const seekTo = (t) => {
    if (live) {
      const target = clampToLive(config, t, now);
      const patch = { live_delay_s: liveEdge(config, now) - target };
      if (!party.is_playing) Object.assign(patch, { anchor_position: target, anchor_time: now });
      return { ...patch, ...version };
    }
    const { start, end } = playbackRange(config);
    return { anchor_position: Math.min(Math.max(t, start), end), anchor_time: now, ...version };
  };

  switch (action) {
    case 'seek':
      return seekTo(arg);
    case 'skip':
      return seekTo(current + arg);
    case 'goLive':
      return live ? { live_delay_s: 0, is_playing: true, ...version } : null;
    case 'pause':
      return { is_playing: false, anchor_position: current, anchor_time: now, ...version };
    case 'play':
      if (live) {
        return { is_playing: true, live_delay_s: Math.max(0, liveEdge(config, now) - Number(party.anchor_position ?? current)), ...version };
      }
      return { is_playing: true, anchor_position: current, anchor_time: now, ...version };
    default:
      return null;
  }
}
