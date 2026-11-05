import { useEffect, useRef, useState } from 'react';
import { EyeOff, SkipBack } from 'lucide-react';
import { liveEdge, videoToMatchClock } from '../../lib/matchTime.js';
import { eventMeta, teamInfo } from '../../lib/format.js';
import { EventIcon, GafferIcon } from '../Icons.jsx';
import { Switch } from '../ui.jsx';

// Tracks newly revealed timeline events. Small batches (normal playback) are
// marked fresh for 3 s and reported through onNew; big jumps (seeks) are not.
export function useFreshEvents(visibleIds, onNew) {
  const prev = useRef(null);
  const [fresh, setFresh] = useState(() => new Set());
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  const key = visibleIds.join('|');

  useEffect(() => {
    const ids = key ? key.split('|') : [];
    if (prev.current === null) {
      prev.current = new Set(ids);
      return undefined;
    }
    const added = ids.filter((id) => !prev.current.has(id));
    prev.current = new Set(ids);
    if (!added.length || added.length > 3) return undefined;
    setFresh((f) => new Set([...f, ...added]));
    onNewRef.current?.(added.length);
    const t = setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !added.includes(id)))), 3000);
    return () => clearTimeout(t);
  }, [key]);

  return fresh;
}

export function visibleKeyEvents(keyEvents, position) {
  return keyEvents.filter((e) => e.video_time <= position);
}

export default function TimelineTab({
  match, keyEvents, position, now, fresh, highlightId, onAsk, onJump, onGoLive,
}) {
  const config = match.config;
  const live = match.mode === 'live';
  const [showAll, setShowAll] = useState(false);
  const highlightRef = useRef(null);

  const list = (live || !showAll ? visibleKeyEvents(keyEvents, position) : keyEvents).slice().reverse();
  const mc = videoToMatchClock(config, position);
  const edge = live ? liveEdge(config, now) : null;
  const hidden = live ? keyEvents.filter((e) => e.video_time > position && e.video_time <= edge).length : 0;
  const behind = live && edge - position >= 5;

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightId]);

  return (
    <div className="tab-body scroll">
      <div className="tl-head">
        <h2 className="tab-h">Match events</h2>
        <span className="tl-minute">
          <span className="d" style={{ background: live ? 'var(--live)' : 'var(--text)' }} />
          {behind ? 'Watching ' : ''}{mc.inPlay ? mc.minute : mc.phase.toLowerCase().replace(/^./, (c) => c.toUpperCase())}
        </span>
      </div>

      {hidden > 0 && behind && (
        <div className="tl-notice">
          <EyeOff size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>{hidden} newer {hidden === 1 ? 'event is' : 'events are'} hidden while you're behind live.</span>
          {onGoLive && <button type="button" className="btn btn-xs" style={{ border: '1px solid var(--warn)', color: 'var(--warn)', background: 'transparent' }} onClick={onGoLive}>Go Live</button>}
        </div>
      )}

      {!live && (
        <div className="tl-toggle">
          <span id="tl-full">Show full match (spoilers)</span>
          <Switch checked={showAll} onChange={setShowAll} labelledBy="tl-full" />
        </div>
      )}

      {list.length === 0 ? (
        <p className="tl-empty">No events yet. They'll appear here as the {live ? 'match' : 'replay'} reaches them, so nobody gets spoiled.</p>
      ) : (
        <ol className="tl-list" aria-label="Match events, newest first">
          {list.map((e) => {
            const meta = eventMeta(e, config);
            const team = e.team ? teamInfo(config, e.team) : null;
            const future = e.video_time > position;
            const isPeriod = e.type === 'period_start' || e.type === 'period_end';
            const iconCls = meta.icon === 'goal' ? 'goal' : meta.icon === 'pen' || meta.icon === 'var' ? 'warn' : meta.icon === 'yellow' ? 'yellow' : meta.icon === 'red' ? 'red' : '';
            const cls = ['tl-event', fresh?.has(e.id) || highlightId === e.id ? 'fresh' : '', future ? 'future' : ''].join(' ');
            return (
              <li key={e.id} className={cls} ref={highlightId === e.id ? highlightRef : undefined}>
                {team && <span className="teambar" style={{ background: team.color }} aria-hidden="true" />}
                <span className="min">{e.clock}</span>
                <span className={`ic ${iconCls}`}><EventIcon kind={meta.icon} /></span>
                <div className="main">
                  <div className="top">
                    <span className={`title ${e.type === 'goal' ? 'goal' : ''}`}>{meta.title}</span>
                    {team && <span className="team-chip" style={{ color: team.text }}>{team.short}</span>}
                    {e.type === 'goal' && e.score_after && (
                      <span className="score-chip">{e.score_after[config.home]}–{e.score_after[config.away]}</span>
                    )}
                    {e.approximate && <span className="tag-sm" style={{ color: 'var(--muted-3)', background: 'var(--line)' }}>≈ minute</span>}
                  </div>
                  {e.player && <span className="player">{e.player}</span>}
                  <span className="desc">{e.description}</span>
                  {(onAsk || onJump) && !future && (
                    <div className="acts">
                      {onAsk && !isPeriod && (
                        <button type="button" className="tl-act" onClick={() => onAsk(e)}>
                          <GafferIcon size={13} />Ask Gaffer
                        </button>
                      )}
                      {onJump && (
                        <button type="button" className="tl-act neutral" onClick={() => onJump(e)}>
                          <SkipBack size={13} strokeWidth={2.2} aria-hidden="true" />Jump to
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {config.data_credit && <p className="tl-credit">{config.data_credit}</p>}
    </div>
  );
}
