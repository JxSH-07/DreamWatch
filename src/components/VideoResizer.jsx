import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_PLAYER = 420;
const MIN_SIDE = 300;
const GRID_CHROME = 60; // grid padding + column gap

function readWidth(key) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

// Width of the video column in px, or null for the default layout. Remembered per browser.
export function usePlayerWidth(key = 'dw.playerWidth') {
  const [width, setWidth] = useState(() => readWidth(key));
  useEffect(() => {
    try {
      if (width == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(Math.round(width)));
    } catch { /* per-viewer convenience only */ }
  }, [key, width]);
  return [width, setWidth];
}

// The video can grow until the side panel hits its minimum width, or until the
// 16:9 picture would be taller than the window.
function clampWidth(w, container) {
  const byPanel = container ? container.clientWidth - GRID_CHROME - MIN_SIDE : 2000;
  const byHeight = ((window.innerHeight - 150) * 16) / 9;
  return Math.round(Math.max(MIN_PLAYER, Math.min(w, byPanel, byHeight)));
}

// Drag handles on the video's right edge and bottom-right corner. Dragging changes
// the video's width (its height follows at 16:9); the side panel takes the rest.
export function VideoResizer({ width, setWidth, containerRef, playerRef }) {
  const drag = useRef(null);
  const [active, setActive] = useState(false);

  const current = () => width ?? playerRef.current?.offsetWidth ?? 800;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: current() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setWidth(clampWidth(drag.current.startWidth + (e.clientX - drag.current.startX), containerRef.current));
  };
  const end = () => {
    drag.current = null;
    setActive(false);
  };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(clampWidth(current() + step, containerRef.current)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(clampWidth(current() - step, containerRef.current)); }
    if (e.key === 'Escape' || e.key === 'Home') { e.preventDefault(); setWidth(null); }
  };

  const reclamp = useCallback(() => {
    setWidth((w) => (w == null ? w : clampWidth(w, containerRef.current)));
  }, [setWidth, containerRef]);
  useEffect(() => {
    reclamp();
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [reclamp]);

  const handlers = {
    onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end,
    onDoubleClick: () => setWidth(null),
  };

  return (
    <>
      <div
        className={`video-resizer ${active ? 'active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize video"
        aria-valuenow={Math.round(current())}
        title="Drag to resize the video · double-click to reset"
        tabIndex={0}
        onKeyDown={onKeyDown}
        {...handlers}
      >
        <span className="grip" aria-hidden="true" />
      </div>
      <div className={`video-resizer-corner ${active ? 'active' : ''}`} aria-hidden="true" title="Drag to resize the video" {...handlers}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M11 3 3 11M11 7 7 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      {active && <span className="video-size-tip tab-num" aria-hidden="true">{Math.round(current())} px</span>}
    </>
  );
}
