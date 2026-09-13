import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag to turn the chart in space.
 *
 * The previous version was a single fixed rotateX, which is a picture of a
 * tilt rather than a thing you can turn. This tracks a pointer across both
 * axes, carries a little momentum when you let go, and settles rather than
 * springing, because a chart that bounces is a chart nobody trusts.
 *
 * Rotation is written straight to the element through a ref inside an
 * animation frame. Putting it in React state would re-render the whole
 * chart on every pointer move, and d3 would redraw underneath it.
 *
 * Bounded on the X axis because past about fifty degrees the plot is edge
 * on and unreadable, and unbounded on Y because turning all the way round
 * is the natural thing to try and there is no reason to stop it.
 */
export interface Tilt {
  x: number;
  y: number;
}

const MAX_X = 52;
const FRICTION = 0.94;
const REST = 0.02;

export function useTilt3D(enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const tilt = useRef<Tilt>({ x: 0, y: 0 });
  const velocity = useRef<Tilt>({ x: 0, y: 0 });
  const dragging = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const paint = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { x, y } = tilt.current;
    el.style.transform = enabled
      ? `perspective(900px) rotateX(${x.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg)`
      : '';
    // Layers inside the plot separate as it turns, so the rotation shows
    // structure rather than skewing one flat image. The further a layer is
    // meant to sit behind the price, the more it lags.
    const lean = Math.abs(x) + Math.abs(y % 360);
    el.style.setProperty('--tilt-depth', String(Math.min(lean / 60, 1)));
  }, [enabled]);

  const settle = useCallback(() => {
    const v = velocity.current;
    if (dragging.current) {
      frame.current = null;
      return;
    }
    if (Math.abs(v.x) < REST && Math.abs(v.y) < REST) {
      frame.current = null;
      return;
    }
    tilt.current.x = Math.max(-MAX_X, Math.min(MAX_X, tilt.current.x + v.x));
    tilt.current.y += v.y;
    v.x *= FRICTION;
    v.y *= FRICTION;
    paint();
    frame.current = requestAnimationFrame(settle);
  }, [paint]);

  const kick = useCallback(() => {
    if (reduced) return;
    if (frame.current === null) frame.current = requestAnimationFrame(settle);
  }, [reduced, settle]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!enabled) return;
    // Let the scrubber keep its own gestures; turning is for the frame.
    if ((e.target as HTMLElement).closest('[data-no-tilt]')) return;
    dragging.current = true;
    setIsDragging(true);
    last.current = { x: e.clientX, y: e.clientY };
    velocity.current = { x: 0, y: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [enabled]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !last.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    // Vertical drag turns it towards you, horizontal turns it about its
    // own axis, which is what a hand expects of a panel on a table.
    tilt.current.x = Math.max(-MAX_X, Math.min(MAX_X, tilt.current.x - dy * 0.35));
    tilt.current.y += dx * 0.35;
    velocity.current = { x: -dy * 0.06, y: dx * 0.06 };
    paint();
  }, [paint]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    last.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    kick();
  }, [kick]);

  /** Arrow keys turn it too, because a drag is not available to everyone. */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!enabled) return;
    const step = e.shiftKey ? 15 : 5;
    const t = tilt.current;
    switch (e.key) {
      case 'ArrowLeft': t.y -= step; break;
      case 'ArrowRight': t.y += step; break;
      case 'ArrowUp': t.x = Math.max(-MAX_X, t.x - step); break;
      case 'ArrowDown': t.x = Math.min(MAX_X, t.x + step); break;
      case 'Home':
      case 'Escape': t.x = 0; t.y = 0; break;
      default: return;
    }
    e.preventDefault();
    paint();
  }, [enabled, paint]);

  const reset = useCallback(() => {
    velocity.current = { x: 0, y: 0 };
    tilt.current = { x: 0, y: 0 };
    paint();
  }, [paint]);

  useEffect(() => {
    // Entering the mode leans it just enough to read as dimensional, so
    // nobody has to discover the gesture to see that there is one.
    if (enabled) {
      tilt.current = reduced ? { x: 0, y: 0 } : { x: 14, y: -8 };
    } else {
      tilt.current = { x: 0, y: 0 };
    }
    velocity.current = { x: 0, y: 0 };
    paint();
  }, [enabled, reduced, paint]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  return { ref, isDragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown, reset };
}
