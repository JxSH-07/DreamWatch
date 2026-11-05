import { useEffect, useState } from 'react';
import { serverNow } from '../lib/serverClock.js';

// Re-renders every `intervalMs` with the current server time (seconds).
export function useNow(intervalMs = 500) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
