import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A row you can actually get along.
 *
 * The first version was overflow-x with the scrollbar hidden, which is what
 * every phone app does and which works on a phone and nowhere else. On a
 * desktop there is no thumb to grab, a wheel scrolls the page instead of the
 * row, and the only way through is a modifier key nobody knows about. Four
 * of the six things on the shelf could not be reached at all.
 *
 * So: drag it with the pointer, roll a wheel over it, or press an arrow. The
 * arrows only appear when there is something past the edge and they go away
 * again at the end of the run, so they say how far there is left to go as
 * well as moving it.
 */
export const Shelf: React.FC<{
  children: React.ReactNode;
  className?: string;
  /** Read out to somebody who cannot see the row. */
  label?: string;
}> = ({ children, className = '', label }) => {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = rail.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of Array.from(el.children) as Element[]) ro.observe(c);
    return () => ro.disconnect();
  }, [measure, children]);

  /** One tile and a bit, so the eye keeps its place. */
  const nudge = (dir: -1 | 1) => {
    const el = rail.current;
    if (!el) return;
    const step = (el.firstElementChild as HTMLElement)?.offsetWidth ?? 140;
    el.scrollBy({ left: dir * (step + 8) * 2, behavior: 'smooth' });
  };

  // Drag. Held below a few pixels of movement so a tap still lands on the
  // tile under it rather than being eaten as the start of a drag.
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return; // the platform already does this
    const el = rail.current;
    if (!el) return;
    drag.current = { x: e.clientX, from: el.scrollLeft, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = rail.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    el.scrollLeft = d.from - dx;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    // A drag that moved should not also count as a click on whatever it
    // finished over.
    if (d?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // A wheel over the row moves the row. A trackpad already sends deltaX for
  // a sideways swipe, so only a plain vertical wheel needs translating, and
  // only while there is somewhere left to go, otherwise the page locks up
  // under the pointer.
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = el.scrollLeft + e.deltaY;
      if (next < 0 || next > max) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const any = edges.left || edges.right;

  return (
    <div className="shelf-wrap">
      {/* Above the row rather than over it. Arrows floating on top of the
          first and last tile cover the price, which is the one thing on a
          tile somebody is looking at. */}
      {any && (
        <div className="shelf-nav">
          <button type="button" className="shelf-arrow" onClick={() => nudge(-1)}
            disabled={!edges.left} aria-label="back">
            &#8249;
          </button>
          <button type="button" className="shelf-arrow" onClick={() => nudge(1)}
            disabled={!edges.right} aria-label="forward">
            &#8250;
          </button>
        </div>
      )}

      <div
        ref={rail}
        className={`shelf ${className}${edges.right ? ' has-more' : ''}`}
        role="list"
        aria-label={label}
        onScroll={measure}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        {children}
      </div>
    </div>
  );
};
