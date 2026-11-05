import { useState } from 'react';
import { Lock } from 'lucide-react';
import { liveEdge, playbackRange, videoToMatchClock } from '../../lib/matchTime.js';
import { teamInfo } from '../../lib/format.js';

const PERIOD_LABELS = { 2: 'HT', 3: 'FT 90', 4: 'ET HT', 5: 'PENS' };

// Live: track spans the whole loop, region after the live edge is locked.
// Replay: full range with goal markers.
export default function SeekBar({ match, events, position, now, onSeek }) {
  const config = match.config;
  const live = match.mode === 'live';
  const { start, end } = playbackRange(config);
  const span = end - start;
  const edge = live ? liveEdge(config, now) : end;
  const [scrub, setScrub] = useState(null);

  const pct = (t) => `${(((t - start) / span) * 100).toFixed(3)}%`;
  const value = scrub ?? position;

  const goals = events.filter((e) => e.type === 'goal' && (!live || e.video_time <= edge));
  const periods = Object.entries(config.period_starts)
    .filter(([p, t]) => Number(p) >= 2 && t > start && t < end && (!live || t <= edge))
    .map(([p, t]) => ({ p, t, label: PERIOD_LABELS[p] }));

  const change = (e) => {
    const v = Number(e.target.value);
    setScrub(Math.min(v, edge));
  };
  const commit = () => {
    if (scrub == null) return;
    onSeek(scrub);
    setScrub(null);
  };

  return (
    <div className="seek">
      <div className="seek-track" aria-hidden="true">
        {live && <div className="seek-avail" style={{ width: pct(edge) }} />}
        <div className="seek-played" style={{ width: pct(value) }} />
        {live && <div className="seek-locked" style={{ left: pct(edge) }} />}
      </div>
      {periods.map((m) => (
        <span key={m.p} aria-hidden="true">
          <span className="seek-period" style={{ left: pct(m.t) }} title={m.label} />
          <span className="seek-period-label" style={{ left: pct(m.t) }}>{m.label}</span>
        </span>
      ))}
      {goals.map((g) => (
        <span
          key={g.id}
          className="seek-marker"
          aria-hidden="true"
          title={`${g.clock} ${g.player ?? 'Goal'}`}
          style={{ left: pct(g.video_time), background: teamInfo(config, g.team).color }}
        />
      ))}
      {live && (
        <>
          <span className="seek-edge" aria-hidden="true" style={{ left: pct(edge) }} />
          {end - edge > span * 0.12 && (
            <span className="seek-lock-label" aria-hidden="true"><Lock size={10} strokeWidth={2.6} />Not aired yet</span>
          )}
        </>
      )}
      <label htmlFor="seek-input" className="sr-only">Seek</label>
      <input
        id="seek-input"
        className="seek-input"
        type="range"
        min={start}
        max={end}
        step={1}
        value={Math.round(value)}
        onChange={change}
        onPointerUp={commit}
        onKeyUp={commit}
        onTouchEnd={commit}
        onBlur={commit}
        aria-valuetext={videoToMatchClock(config, value).clock}
      />
    </div>
  );
}
