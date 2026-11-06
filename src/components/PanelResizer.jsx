import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 820;
const MIN_PLAYER = 420; // keep the video at least this wide

function readWidth(key) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

// Width of the side panel next to the video, adjustable by dragging a handle.
// Narrowing the panel makes the video bigger. Remembered per browser.
export function usePanelWidth(key = 'dw.sidePanelWidth') {
  const [width, setWidth] = useState(() => readWidth(key));
  useEffect(() => {
    try { localStorage.setItem(key, String(Math.round(width))); } catch { /* per-viewer convenience only */ }
  }, [key, width]);
  return [width, setWidth];
}

function clampWidth(w, container) {
  const room = container ? container.clientWidth - MIN_PLAYER - 60 : MAX_WIDTH;
  return Math.round(Math.min(Math.max(w, MIN_WIDTH), Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, room))));
}

// Vertical drag handle on the panel's left edge. `containerRef` is the grid.
export function PanelResizer({ width, setWidth, containerRef }) {
  const drag = useRef(null);
  const [active, setActive] = useState(false);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const next = drag.current.startWidth + (drag.current.startX - e.clientX);
    setWidth(clampWidth(next, containerRef.current));
  };
  const end = () => {
    drag.current = null;
    setActive(false);
  };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth((w) => clampWidth(w + step, containerRef.current)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setWidth((w) => clampWidth(w - step, containerRef.current)); }
    if (e.key === 'Home') { e.preventDefault(); setWidth(clampWidth(MAX_WIDTH, containerRef.current)); }
    if (e.key === 'End') { e.preventDefault(); setWidth(MIN_WIDTH); }
  };

  // Re-clamp when the window shrinks.
  const reclamp = useCallback(() => setWidth((w) => clampWidth(w, containerRef.current)), [setWidth, containerRef]);
  useEffect(() => {
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [reclamp]);

  return (
    <div
      className={`panel-resizer ${active ? 'active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize video and side panel"
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      title="Drag to resize the video · double-click to reset"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
    >
      <span className="grip" aria-hidden="true" />
    </div>
  );
}
