import { useEffect, useRef, useState } from 'react';
import { scoreAt, videoToMatchClock } from '../../lib/matchTime.js';
import { eventMeta, teamInfo } from '../../lib/format.js';

const BANNER_TYPES = new Set(['goal', 'card', 'penalty_awarded', 'var_decision']);

export default function Scorebug({ match, events, position }) {
  const config = match.config;
  const home = teamInfo(config, config.home);
  const away = teamInfo(config, config.away);
  const score = scoreAt(config, events, position);
  const mc = videoToMatchClock(config, position);
  const banner = useEventBanner(events, position, config);

  const phase = score.shootout && mc.period >= 5
    ? `${mc.phase} · ${score.shootout.home}–${score.shootout.away}`
    : match.mode === 'replay' ? `REPLAY · ${mc.phase}` : mc.phase;

  return (
    <div className="scorebug">
      <div className="scorebug-row" role="group" aria-label={`Score: ${home.name} ${score.home}, ${away.name} ${score.away}, ${mc.clock}`}>
        <div className="team h"><span className="bar" style={{ background: home.color }} />{home.short}</div>
        <div className="score"><span>{score.home}</span><span className="dash">–</span><span>{score.away}</span></div>
        <div className="team a">{away.short}<span className="bar" style={{ background: away.color }} /></div>
        <div className="clock">{mc.clock}</div>
      </div>
      <span className="phase">{phase}</span>
      {banner && (
        <div key={banner.id} className="event-banner" style={{ background: banner.bg }}>{banner.text}</div>
      )}
    </div>
  );
}

// Shows a short banner when a goal / card / penalty is reached during normal playback
// (not after a seek, and not on first load).
function useEventBanner(events, position, config) {
  const [banner, setBanner] = useState(null);
  const lastId = useRef(undefined);
  const timer = useRef(null);

  const latest = [...events].reverse().find((e) => e.importance === 'key' && BANNER_TYPES.has(e.type) && e.video_time <= position);

  useEffect(() => {
    const id = latest?.id ?? null;
    if (lastId.current === undefined) {
      lastId.current = id;
      return;
    }
    if (id === lastId.current) return;
    lastId.current = id;
    if (!latest || position - latest.video_time > 6) return;
    const meta = eventMeta(latest, config);
    if (!meta.banner) return;
    setBanner({ id, text: meta.banner, bg: meta.bannerBg });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setBanner(null), 4600);
  }, [latest, position, config]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return banner;
}
