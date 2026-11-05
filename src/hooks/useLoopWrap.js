import { useEffect, useRef } from 'react';
import { liveEdge } from '../lib/matchTime.js';

// Calls onWrap when the looping live broadcast jumps from near the end back to kick-off.
export function useLoopWrap(match, now, onWrap) {
  const prev = useRef(null);
  const cb = useRef(onWrap);
  cb.current = onWrap;
  useEffect(() => {
    if (!match || match.mode !== 'live') return;
    const edge = liveEdge(match.config, now);
    if (prev.current != null && edge < prev.current - 60) cb.current?.();
    prev.current = edge;
  }, [match, now]);
}
