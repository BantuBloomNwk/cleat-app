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
 *
 * The same gesture drives the WebGL mesh. It has to be this hook rather than
 * its own handlers, or the card ends up with two drags that disagree about
 * where they are pointing. `onTilt` gets the angles every frame; pass
 * `cssTransform: false` when the consumer paints them itself.
 */
export interface Tilt {
  x: number;
  y: number;
}

const MAX_X = 52;

/** Bounded turn, or free when the limit is not finite. */
const clamp = (v: number, limit: number) =>
  Number.isFinite(limit) ? Math.max(-limit, Math.min(limit, v)) : v;
const FRICTION = 0.94;
const REST = 0.02;

export interface TiltOptions {
  /** Called with the current angles on every frame that changes them. */
  onTilt?: (t: Tilt) => void;
  /** Write a CSS transform to the ref. Off when a renderer owns the camera. */
  cssTransform?: boolean;
  /**
   * How far the X axis may turn, in degrees.
   *
   * A flat panel has to stop before it goes edge on, because past that there
   * is nothing to look at. A scene does not: turning all the way over and
   * looking at it from underneath is a thing people try immediately, and
   * stopping them at fifty two degrees is what makes a full orbit feel like
   * two thirds of one. Pass Infinity for a renderer that can be looked at
   * from any side.
   */
  maxX?: number;
}

export function useTilt3D(enabled: boolean, opts: TiltOptions = {}) {
  const { onTilt, cssTransform = true, maxX = MAX_X } = opts;
  const emit = useRef(onTilt);
  emit.current = onTilt;
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
    const { x, y } = tilt.current;
    emit.current?.({ x, y });
    const el = ref.current;
    if (!el || !cssTransform) return;
    el.style.transform = enabled
      ? `perspective(900px) rotateX(${x.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg)`
      : '';
    // Layers inside the plot separate as it turns, so the rotation shows
    // structure rather than skewing one flat image. The further a layer is
    // meant to sit behind the price, the more it lags.
    const lean = Math.abs(x) + Math.abs(y % 360);
    el.style.setProperty('--tilt-depth', String(Math.min(lean / 60, 1)));
  }, [enabled, cssTransform]);

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
    tilt.current.x = clamp(tilt.current.x + v.x, maxX);
    tilt.current.y += v.y;
    v.x *= FRICTION;
    v.y *= FRICTION;
    paint();
    frame.current = requestAnimationFrame(settle);
  }, [paint, maxX]);

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
    tilt.current.x = clamp(tilt.current.x - dy * 0.35, maxX);
    tilt.current.y += dx * 0.35;
    velocity.current = { x: -dy * 0.06, y: dx * 0.06 };
    paint();
  }, [paint, maxX]);

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
      case 'ArrowUp': t.x = clamp(t.x - step, maxX); break;
      case 'ArrowDown': t.x = clamp(t.x + step, maxX); break;
      case 'Home':
      case 'Escape': t.x = 0; t.y = 0; break;
      default: return;
    }
    e.preventDefault();
    paint();
  }, [enabled, paint, maxX]);

  /**
   * Travel to an angle rather than jump to it.
   *
   * Snapping the camera to a useful viewpoint is only useful if you can see
   * how you got there. An instant cut loses the relationship between the view
   * you had and the view you asked for, which is the whole reason for offering
   * the shortcut.
   */
  const to = useCallback((x: number, y: number, ms = 620) => {
    velocity.current = { x: 0, y: 0 };
    if (reduced) {
      tilt.current = { x: clamp(x, maxX), y };
      paint();
      return;
    }
    const from = { ...tilt.current };
    // Take the short way round. Turning 350 degrees to reach something ten
    // degrees away is technically correct and looks broken.
    let dy = y - from.y;
    dy -= Math.round(dy / 360) * 360;
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      tilt.current = { x: clamp(from.x + (x - from.x) * e, maxX), y: from.y + dy * e };
      paint();
      if (t < 1 && !dragging.current) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [paint, maxX, reduced]);

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

  return { ref, isDragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown, reset, to };
}
