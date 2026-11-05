import { useEffect, useRef, useState } from 'react';
import { YT_STATE } from './useYouTubePlayer.js';

// Keeps the YouTube player on the authoritative position (HANDOFF §9.6).
// getTarget() returns the target video time; isPlaying says whether it should run.
export function usePlayerSync({ playerRef, ready, started, getTarget, isPlaying, version }) {
  const [sync, setSync] = useState('ok'); // 'ok' | 'resync'
  const lastSeek = useRef(0);
  const targetRef = useRef(getTarget);
  const playingRef = useRef(isPlaying);
  const resyncTimer = useRef(null);
  targetRef.current = getTarget;
  playingRef.current = isPlaying;

  useEffect(() => {
    if (!ready || !started) return undefined;
    const tick = (force) => {
      const p = playerRef.current;
      if (!p?.getPlayerState) return;
      const state = p.getPlayerState();
      const target = targetRef.current();
      const nowMs = Date.now();
      if ((force || nowMs - lastSeek.current > 2000) && state !== YT_STATE.BUFFERING) {
        const actual = p.getCurrentTime();
        if (Math.abs(actual - target) > 1.5) {
          p.seekTo(target, true);
          lastSeek.current = nowMs;
          setSync('resync');
          clearTimeout(resyncTimer.current);
          resyncTimer.current = setTimeout(() => setSync('ok'), 1500);
        }
      }
      if (playingRef.current && state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING) p.playVideo();
      if (!playingRef.current && state === YT_STATE.PLAYING) p.pauseVideo();
    };
    tick(true);
    const id = setInterval(() => tick(false), 1000);
    return () => clearInterval(id);
  }, [ready, started, version, playerRef]);

  useEffect(() => () => clearTimeout(resyncTimer.current), []);
  return sync;
}
