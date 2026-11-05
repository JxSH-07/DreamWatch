import { useEffect, useRef, useState } from 'react';

let apiPromise = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

// Creates a YT.Player inside hostRef. The player is only exposed after onReady,
// so callers never touch it early. Safe under StrictMode double-effects.
export function useYouTubePlayer(videoId) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!videoId) return undefined;
    let cancelled = false;
    let player = null;
    setError(null);

    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      const el = document.createElement('div');
      hostRef.current.appendChild(el);
      player = new YT.Player(el, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1,
          iv_load_policy: 3, fs: 0, origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            playerRef.current = player;
            setReady(true);
          },
          onError: (e) => {
            console.error('YouTube player error', e.data);
            if (!cancelled) setError(e.data);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      setReady(false);
      playerRef.current = null;
      try { player?.destroy(); } catch { /* already gone */ }
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [videoId]);

  return { hostRef, playerRef, ready, error };
}
