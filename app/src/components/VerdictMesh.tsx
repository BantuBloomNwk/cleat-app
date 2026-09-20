import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { outcomeLabel, reasonText, type PlacedVerdict } from '../lib/chain';
import { useTilt3D, type Tilt } from '../utils/useTilt3D';
import { tactile } from '../utils/haptics';

/**
 * The shape of a mandate, drawn from the decisions it actually made.
 *
 * The thing this replaced was a CSS transform on a flat chart: a picture of a
 * tilt rather than a space, turning a sample. This is a real one, and every
 * point in it is a verdict that exists on devnet. If a point has no decision
 * behind it, it is not here. That is the whole reason the view is worth having,
 * because a sculpture generated from a design file would say nothing about
 * whether the boundary holds.
 *
 * What the axes mean:
 *
 *   x  when it happened, oldest at the left
 *   y  how far the ask reached past what the sentence allowed
 *   z  which sector it was asked for
 *   colour   cleared, trimmed or refused
 *   height   the share held back, so a tall column is a large refusal
 *
 * The plane is the ceiling. Everything that rises through it was stopped, and
 * the columns standing above it are the ones the agent did not get. Markets
 * drift, and this is the drawing of holding.
 *
 * Written against WebGL2 directly rather than a scene library. There are three
 * draw calls and a few hundred vertices, a library would be several hundred
 * kilobytes to avoid arithmetic that fits on a screen, and the same code has to
 * survive being packaged into an Android build later.
 */

interface Props {
  verdicts: PlacedVerdict[];
  /** Turned off when the card is showing something else, so nothing renders. */
  active: boolean;
  /** Position cap in basis points, which is where the ceiling sits. */
  ceilingBps: number;
}

/** cleared, trimmed, refused. Read off the stylesheet so themes carry. */
const OUTCOME_VARS = ['--verdigris', '--trimmed-amber', '--refused-rust'];

const cssRgb = (name: string, fallback: [number, number, number]) => {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = v.match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as [number, number, number];
  }
  const rgb = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgb) return [+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255] as [number, number, number];
  return fallback;
};

/* ---------- a very small amount of matrix arithmetic ---------- */

type M4 = Float32Array;

const identity = (): M4 => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

function multiply(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] =
        a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] +
        a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
}

function perspective(fovY: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function rotateX(rad: number): M4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  const m = identity();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

function rotateY(rad: number): M4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  const m = identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

function translate(x: number, y: number, z: number): M4 {
  const m = identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** Project a model space point to normalised device coordinates. */
function project(m: M4, x: number, y: number, z: number) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return {
    x: (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    y: (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    w,
  };
}

/* ---------- placing the verdicts ---------- */

interface Placed {
  v: PlacedVerdict;
  x: number;
  y: number;
  z: number;
  height: number;
  colour: [number, number, number];
}

const SECTORS = 6;

function place(verdicts: PlacedVerdict[], ceilingBps: number): Placed[] {
  if (verdicts.length === 0) return [];
  const slots = verdicts.map((v) => Number(v.slot));
  const min = Math.min(...slots);
  const span = Math.max(1, Math.max(...slots) - min);
  const colours = OUTCOME_VARS.map((n, i) =>
    cssRgb(n, [[0.16, 0.65, 0.6], [0.85, 0.65, 0.23], [0.78, 0.31, 0.22]][i] as [number, number, number]),
  );
  const ceiling = Math.max(1, ceilingBps);

  return verdicts.map((v) => {
    const held = Math.max(0, v.proposedBps - v.allowedBps);
    // Over the ceiling is the interesting direction, so the axis is the ask
    // measured against the cap rather than the raw size. One whole unit is one
    // whole ceiling past it.
    const over = (v.proposedBps - ceiling) / ceiling;
    return {
      v,
      x: ((Number(v.slot) - min) / span) * 2 - 1,
      y: Math.max(-0.35, Math.min(1.25, over)),
      z: ((v.category % SECTORS) / (SECTORS - 1)) * 1.6 - 0.8,
      height: Math.min(1, held / ceiling),
      colour: colours[v.outcome] ?? colours[2],
    };
  });
}

/* ---------- shaders ---------- */

const POINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColour;
layout(location = 2) in float aSize;
uniform mat4 uMvp;
uniform float uScale;
out vec3 vColour;
out float vDepth;
void main() {
  vec4 clip = uMvp * vec4(aPos, 1.0);
  gl_Position = clip;
  // Nearer points are larger, which is the only depth cue a point cloud has.
  gl_PointSize = clamp(uScale * (4.0 + aSize * 16.0) / max(clip.w, 0.2), 3.0, 34.0);
  vColour = aColour;
  vDepth = clip.w;
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vColour;
in float vDepth;
out vec4 outColour;
void main() {
  // Round, with a soft edge. A square point reads as a rendering artifact.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;
  float edge = smoothstep(0.5, 0.36, r);
  float fog = clamp(1.25 - vDepth * 0.16, 0.35, 1.0);
  outColour = vec4(vColour * fog, edge);
}`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uMvp;
out float vY;
void main() {
  gl_Position = uMvp * vec4(aPos, 1.0);
  vY = aPos.y;
}`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec3 uColour;
uniform float uAlpha;
out vec4 outColour;
void main() { outColour = vec4(uColour, uAlpha); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const mk = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const v = mk(gl.VERTEX_SHADER, vs);
  const f = mk(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

export const VerdictMesh: React.FC<Props> = ({ verdicts, active, ceilingBps }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Placed | null>(null);

  const points = useMemo(() => place(verdicts, ceilingBps), [verdicts, ceilingBps]);

  // The camera, written to by the gesture and read by the frame. Never state:
  // a re-render per pointer move would rebuild the buffers underneath it.
  const angles = useRef<Tilt>({ x: 16, y: -22 });
  const mvpRef = useRef<M4>(identity());
  const needsPaint = useRef(true);

  const onTilt = useCallback((t: Tilt) => {
    angles.current = t;
    needsPaint.current = true;
  }, []);

  const tilt = useTilt3D(active, { onTilt, cssTransform: false });

  /* Pick the nearest point to a tap, in screen space rather than by ray, which
     for a few hundred billboards is both simpler and more forgiving. */
  const pick = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    let best: Placed | null = null;
    let bestD = 0.06; // about twenty pixels on a phone
    for (const p of points) {
      const top = project(mvpRef.current, p.x, p.y + p.height, p.z);
      if (top.w <= 0) continue;
      const d = Math.hypot(top.x - nx, top.y - ny);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) tactile.selectionTap();
    setPicked(best);
  }, [points]);

  useEffect(() => {
    if (!active) { setPicked(null); return; }
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: true,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
    if (!gl) { setFailed(true); return; }

    const pointProg = compile(gl, POINT_VS, POINT_FS);
    const lineProg = compile(gl, LINE_VS, LINE_FS);
    if (!pointProg || !lineProg) { setFailed(true); return; }

    /* Point buffer: the head of each column. */
    const pointData = new Float32Array(points.length * 7);
    points.forEach((p, i) => {
      const o = i * 7;
      pointData[o] = p.x; pointData[o + 1] = p.y + p.height; pointData[o + 2] = p.z;
      pointData[o + 3] = p.colour[0]; pointData[o + 4] = p.colour[1]; pointData[o + 5] = p.colour[2];
      pointData[o + 6] = p.height;
    });
    const pointVao = gl.createVertexArray()!;
    const pointBuf = gl.createBuffer()!;
    gl.bindVertexArray(pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pointData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);

    /* Line buffer: one stem per verdict, plus the ceiling as a grid. */
    const stems: number[] = [];
    for (const p of points) {
      stems.push(p.x, p.y, p.z, p.x, p.y + p.height, p.z);
    }
    const grid: number[] = [];
    const G = 6;
    for (let i = 0; i <= G; i++) {
      const t = (i / G) * 2 - 1;
      grid.push(t, 0, -0.9, t, 0, 0.9);
      grid.push(-1, 0, t * 0.9, 1, 0, t * 0.9);
    }
    const lineData = new Float32Array([...stems, ...grid]);
    const stemVerts = stems.length / 3;
    const gridVerts = grid.length / 3;
    const lineVao = gl.createVertexArray()!;
    const lineBuf = gl.createBuffer()!;
    gl.bindVertexArray(lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    const uMvpPoint = gl.getUniformLocation(pointProg, 'uMvp');
    const uScale = gl.getUniformLocation(pointProg, 'uScale');
    const uMvpLine = gl.getUniformLocation(lineProg, 'uMvp');
    const uColour = gl.getUniformLocation(lineProg, 'uColour');
    const uAlpha = gl.getUniformLocation(lineProg, 'uAlpha');

    const ink = cssRgb('--text-tertiary', [0.55, 0.53, 0.5]);
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      needsPaint.current = true;
    };
    resize();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    let raf = 0;
    let visible = true;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!visible || !needsPaint.current) return;
      needsPaint.current = false;

      const aspect = canvas.width / Math.max(1, canvas.height);
      const proj = perspective((46 * Math.PI) / 180, aspect, 0.1, 40);
      // multiply(a, b) is b * a, because these are column major arrays being
      // indexed row first. So this reads inside out: turn about Y, then about
      // X, then push the whole thing away from the camera. Written the other
      // way round the model orbits the origin from three units out instead of
      // turning where it stands.
      const view = multiply(
        multiply(rotateX((angles.current.x * Math.PI) / 180),
                 rotateY((angles.current.y * Math.PI) / 180)),
        translate(0, -0.12, -3.2),
      );
      const mvp = multiply(view, proj);
      mvpRef.current = mvp;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(lineProg);
      gl.uniformMatrix4fv(uMvpLine, false, mvp);
      gl.bindVertexArray(lineVao);
      // Stems first, dim, then the ceiling over them.
      gl.uniform3f(uColour, ink[0], ink[1], ink[2]);
      gl.uniform1f(uAlpha, 0.33);
      gl.drawArrays(gl.LINES, 0, stemVerts);
      gl.uniform1f(uAlpha, 0.16);
      gl.drawArrays(gl.LINES, stemVerts, gridVerts);

      gl.useProgram(pointProg);
      gl.uniformMatrix4fv(uMvpPoint, false, mvp);
      gl.uniform1f(uScale, dpr);
      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, points.length);
      gl.bindVertexArray(null);
    };
    raf = requestAnimationFrame(draw);

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) needsPaint.current = true;
    }, { threshold: 0.01 });
    io.observe(host);

    const onHidden = () => { visible = !document.hidden; needsPaint.current = true; };
    document.addEventListener('visibilitychange', onHidden);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onHidden);
      // Hand the memory back rather than waiting for the tab to close. A view
      // that can be opened a hundred times must not leak a context each time.
      gl.deleteBuffer(pointBuf);
      gl.deleteBuffer(lineBuf);
      gl.deleteVertexArray(pointVao);
      gl.deleteVertexArray(lineVao);
      gl.deleteProgram(pointProg);
      gl.deleteProgram(lineProg);
      // Only kill the context when the canvas itself is going. getContext on a
      // canvas that already has one returns the same object, so a cleanup that
      // fires because the data changed would otherwise hand the next run a
      // context it had just destroyed.
      if (!canvas.isConnected) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    };
  }, [active, points]);

  if (!active) return null;

  if (failed || points.length === 0) {
    return (
      <div className="verdict-mesh-empty" role="note">
        {failed
          ? 'This device will not draw the geometry. The decisions are all in the log below, which is the part that matters.'
          : 'Nothing has been decided yet. The geometry is drawn from real verdicts, so it stays empty until there are some.'}
      </div>
    );
  }

  return (
    <div className="verdict-mesh" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="verdict-mesh-canvas"
        role="application"
        aria-label={`Geometry of ${points.length} decisions. Drag or use the arrow keys to turn it, Escape to reset, tap a point to read it.`}
        tabIndex={0}
        onPointerDown={tilt.onPointerDown}
        onPointerMove={tilt.onPointerMove}
        onPointerUp={tilt.onPointerUp}
        onPointerCancel={tilt.onPointerUp}
        onKeyDown={tilt.onKeyDown}
        onDoubleClick={tilt.reset}
        onClick={(e) => pick(e.clientX, e.clientY)}
      />

      <div className="verdict-mesh-legend" aria-hidden="true">
        <span><i style={{ background: 'var(--verdigris)' }} />cleared</span>
        <span><i style={{ background: 'var(--trimmed-amber)' }} />trimmed</span>
        <span><i style={{ background: 'var(--refused-rust)' }} />refused</span>
      </div>

      <p className="verdict-mesh-caption">
        {points.length} decisions, every one of them on devnet. Height is the
        share held back. The grid is the position cap, so anything standing on
        it was asked for and not given.
      </p>

      {picked && (
        <div className="verdict-mesh-readout" role="status">
          <div className="flex items-center justify-between gap-2">
            <span
              className="font-bold uppercase tracking-wider text-[10px]"
              style={{
                color:
                  picked.v.outcome === 2 ? 'var(--refused-rust)'
                  : picked.v.outcome === 1 ? 'var(--trimmed-amber)'
                  : 'var(--verdigris)',
              }}
            >
              {outcomeLabel(picked.v.outcome)}
            </span>
            <button
              type="button"
              className="text-[10.5px] text-[var(--text-tertiary)] underline underline-offset-2"
              onClick={() => setPicked(null)}
            >
              close
            </button>
          </div>
          <p className="text-[12px] text-[var(--text-primary)] mt-1">
            {reasonText(picked.v.reason) || 'Inside every limit set'}
          </p>
          <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
            Asked {(picked.v.proposedBps / 100).toFixed(2)}%, allowed{' '}
            {(picked.v.allowedBps / 100).toFixed(2)}%, at slot{' '}
            {picked.v.slot.toString()}.
          </p>
          <p className="text-[10.5px] font-mono text-[var(--text-tertiary)] mt-1 break-all">
            {picked.v.logAddress}
          </p>
        </div>
      )}
    </div>
  );
};
