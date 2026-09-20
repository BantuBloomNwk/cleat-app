import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartMarker } from '../types';
import { useTilt3D, type Tilt } from '../utils/useTilt3D';
import { tactile } from '../utils/haptics';

/**
 * The same chart, in a space you can turn.
 *
 * Not a different picture of different data. The curves here are the exact
 * paths the flat chart draws, sampled off the real SVG geometry rather than
 * re-derived, so the shape you turn is the shape you were just reading. What
 * changes is that the things which overlap in two dimensions stop overlapping:
 * the ceiling the mandate set sits behind the price, the floor sits behind it
 * too, and the interventions stand in front, so a refusal occludes the boundary
 * it would have broken instead of sitting flat on top of it.
 *
 * The previous attempt at this failed for a structural reason worth writing
 * down. The layers were `<g>` elements inside one `<svg>` with translateZ on
 * them, and browsers flatten 3D transforms inside SVG. Every transform was
 * correct and none of them did anything, which is why it tilted convincingly
 * and never separated. Depth has to come from something that is not SVG, so
 * here it comes from WebGL.
 */

interface Props {
  active: boolean;
  /** The paths the flat chart draws, in its own 0 0 360 185 viewBox. */
  trajectoryPath: string;
  ceilingPath?: string;
  floorPath?: string;
  markers: ChartMarker[];
  onPickMarker?: (m: ChartMarker) => void;
  selectedId?: string | null;
}

/* The viewBox the chart is authored in. */
const VB_W = 360;
const VB_H = 185;

/** svg space to world space, with each layer on its own plane. */
const toWorld = (x: number, y: number, z: number): [number, number, number] => [
  (x / VB_W) * 2.6 - 1.3,
  0.74 - (y / VB_H) * 1.48,
  z,
];

const Z = { ceiling: -1.05, floor: -0.52, price: 0, marks: 0.55 };

/* ---------- colour ---------- */

type RGB = [number, number, number];

const cssRgb = (name: string, fallback: RGB): RGB => {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = v.match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255] : fallback;
};

const mix = (a: RGB, b: RGB, t: number): RGB =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ---------- matrices, column major, multiply(a, b) is b * a ---------- */

type M4 = Float32Array;
const identity = (): M4 => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

function multiply(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] +
                     a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
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
function rotateX(r: number): M4 {
  const c = Math.cos(r), s = Math.sin(r), m = identity();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m;
}
function rotateY(r: number): M4 {
  const c = Math.cos(r), s = Math.sin(r), m = identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m;
}
function translate(x: number, y: number, z: number): M4 {
  const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m;
}
function project(m: M4, x: number, y: number, z: number) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return {
    x: (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    y: (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    w,
  };
}

/* ---------- sampling the real paths ---------- */

/**
 * Walk the actual path element the browser built, rather than parsing the `d`
 * string. Whatever the curve is, beziers or arcs or something added later,
 * this returns the same points the renderer would have drawn.
 */
function samplePath(d: string, n = 120): Array<[number, number]> {
  if (typeof document === 'undefined' || !d) return [];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  document.body.appendChild(svg);
  const out: Array<[number, number]> = [];
  try {
    const len = path.getTotalLength();
    if (len > 0) {
      for (let i = 0; i <= n; i++) {
        const p = path.getPointAtLength((i / n) * len);
        out.push([p.x, p.y]);
      }
    }
  } catch {
    /* a path the browser will not measure is simply not drawn */
  }
  document.body.removeChild(svg);
  return out;
}

/* ---------- shaders ---------- */

/**
 * Lines with a width, which WebGL does not give you.
 *
 * gl_LineWidth is one pixel everywhere that matters, so each curve is a strip
 * of quads whose thickness is worked out after projection. The offset is
 * perpendicular to the direction of travel in screen space, which keeps a
 * constant width no matter how far the curve has been turned away.
 */
const RIBBON_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNext;
layout(location = 2) in float aSide;
layout(location = 3) in vec3 aColour;
uniform mat4 uMvp;
uniform float uAspect;
uniform float uHalf;
out vec3 vColour;
out float vEdge;
out float vDepth;
void main() {
  vec4 c0 = uMvp * vec4(aPos, 1.0);
  vec4 c1 = uMvp * vec4(aNext, 1.0);
  vec2 n0 = c0.xy / c0.w;
  vec2 n1 = c1.xy / c1.w;
  vec2 dir = n1 - n0;
  if (length(dir) < 1e-6) dir = vec2(1.0, 0.0);
  dir = normalize(dir * vec2(uAspect, 1.0));
  vec2 nrm = vec2(-dir.y, dir.x) / vec2(uAspect, 1.0);
  gl_Position = vec4(c0.xy + nrm * uHalf * aSide * c0.w, c0.z, c0.w);
  vColour = aColour;
  vEdge = aSide;
  vDepth = c0.w;
}`;

const RIBBON_FS = `#version 300 es
precision highp float;
in vec3 vColour;
in float vEdge;
in float vDepth;
uniform float uAlpha;
uniform float uSoft;
out vec4 outColour;
void main() {
  // Soft shoulders make the wide pass read as glow rather than as a fat line.
  float a = pow(1.0 - abs(vEdge), uSoft);
  // Things further away give up light, which is what makes depth legible.
  float fog = clamp(1.7 - vDepth * 0.22, 0.2, 1.0);
  float v = a * uAlpha * fog;
  outColour = vec4(vColour * v, v);
}`;

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
  vec4 c = uMvp * vec4(aPos, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(uScale * aSize / max(c.w, 0.25), 2.0, 64.0);
  vColour = aColour;
  vDepth = c.w;
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vColour;
in float vDepth;
uniform float uCore;
out vec4 outColour;
void main() {
  float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (r > 1.0) discard;
  // A bright centre inside a wide falloff, which is what a light looks like.
  float halo = pow(1.0 - r, 2.6);
  float core = smoothstep(uCore, uCore * 0.35, r);
  float fog = clamp(1.7 - vDepth * 0.22, 0.2, 1.0);
  float a = clamp(halo * 0.7 + core * 1.1, 0.0, 1.6) * fog;
  outColour = vec4(vColour * a, a);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const mk = (t: number, src: string) => {
    const sh = gl.createShader(t)!;
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
    return sh;
  };
  const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
  return p;
}

/** Two vertices per sample, so the strip has a left and a right edge. */
function ribbonBuffer(pts: Array<[number, number]>, z: number, colours: RGB[]) {
  const n = pts.length;
  const data = new Float32Array(n * 2 * 10);
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i];
    const cur = toWorld(x, y, z);
    // Direction from the point before to the point after, rather than from
    // here to the next one. At a sharp peak the forward difference swings
    // through a large angle between one sample and its neighbour, the two
    // quads meeting there are offset along different normals, and the join
    // twists into a visible grey wedge. A central difference turns smoothly
    // through the same corner.
    const [px, py] = pts[Math.max(0, i - 1)];
    const [qx, qy] = pts[Math.min(n - 1, i + 1)];
    let dx = qx - px, dy = qy - py;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) { dx = 1; dy = 0; }
    const nxt = toWorld(x + dx, y + dy, z);
    const col = colours[i];
    for (const side of [-1, 1]) {
      const o = (i * 2 + (side === 1 ? 1 : 0)) * 10;
      data[o] = cur[0]; data[o + 1] = cur[1]; data[o + 2] = cur[2];
      data[o + 3] = nxt[0]; data[o + 4] = nxt[1]; data[o + 5] = nxt[2];
      data[o + 6] = side;
      data[o + 7] = col[0]; data[o + 8] = col[1]; data[o + 9] = col[2];
    }
  }
  return data;
}

/**
 * Straight segments as ribbons, six vertices each.
 *
 * The grid and the stems were drawn with the ribbon program but bound to a
 * buffer that had no colour in it, so every attribute read position bytes and
 * the colour came out negative. Black lines on a black ground, which is why
 * the ground was missing entirely. They get the same layout as the curves now.
 */
function segmentsToRibbon(segs: Array<[number[], number[]]>, colour: RGB) {
  const data = new Float32Array(segs.length * 6 * 10);
  let o = 0;
  const put = (p: number[], nx: number[], side: number) => {
    data[o] = p[0]; data[o + 1] = p[1]; data[o + 2] = p[2];
    data[o + 3] = nx[0]; data[o + 4] = nx[1]; data[o + 5] = nx[2];
    data[o + 6] = side;
    data[o + 7] = colour[0]; data[o + 8] = colour[1]; data[o + 9] = colour[2];
    o += 10;
  };
  for (const [a, b] of segs) {
    const beyond = [2 * b[0] - a[0], 2 * b[1] - a[1], 2 * b[2] - a[2]];
    put(a, b, -1); put(a, b, 1); put(b, beyond, -1);
    put(a, b, 1); put(b, beyond, 1); put(b, beyond, -1);
  }
  return data;
}

export const ChartMesh: React.FC<Props> = ({
  active, trajectoryPath, ceilingPath, floorPath, markers, onPickMarker, selectedId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const angles = useRef<Tilt>({ x: 24, y: -30 });
  const mvpRef = useRef<M4>(identity());
  const needsPaint = useRef(true);

  const onTilt = useCallback((t: Tilt) => {
    angles.current = t;
    needsPaint.current = true;
  }, []);
  const tilt = useTilt3D(active, { onTilt, cssTransform: false });

  const curves = useMemo(() => {
    if (!active) return null;
    return {
      price: samplePath(trajectoryPath),
      ceiling: samplePath(ceilingPath ?? ''),
      floor: samplePath(floorPath ?? ''),
    };
  }, [active, trajectoryPath, ceilingPath, floorPath]);

  const pick = useCallback((cx: number, cy: number) => {
    const canvas = canvasRef.current;
    if (!canvas || markers.length === 0) return;
    const r = canvas.getBoundingClientRect();
    const nx = ((cx - r.left) / r.width) * 2 - 1;
    const ny = -(((cy - r.top) / r.height) * 2 - 1);
    let best: ChartMarker | null = null;
    let bestD = 0.09;
    for (const m of markers) {
      const w = toWorld(m.cx, m.cy, Z.marks);
      const p = project(mvpRef.current, w[0], w[1], w[2]);
      if (p.w <= 0) continue;
      const d = Math.hypot(p.x - nx, p.y - ny);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best) { tactile.selectionTap(); onPickMarker?.(best); }
  }, [markers, onPickMarker]);

  useEffect(() => {
    if (!active || !curves) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: true, antialias: true, depth: true,
      premultipliedAlpha: false, powerPreference: 'low-power',
    });
    if (!gl) { setFailed(true); return; }

    const ribbonProg = compile(gl, RIBBON_VS, RIBBON_FS);
    const pointProg = compile(gl, POINT_VS, POINT_FS);
    if (!ribbonProg || !pointProg) { setFailed(true); return; }

    const verdigris = cssRgb('--verdigris', [0.31, 0.76, 0.65]);
    const ember = cssRgb('--ember', [0.91, 0.55, 0.23]);
    const rust = cssRgb('--refused-rust', [0.79, 0.31, 0.23]);
    const amber = cssRgb('--trimmed-amber', [0.85, 0.65, 0.23]);
    const dim = cssRgb('--text-tertiary', [0.45, 0.45, 0.44]);

    /* The price carries the same gradient the flat chart uses, so the eye
       recognises it as the same object rather than a second drawing. */
    const priceColours = curves.price.map((_, i, a) => {
      const t = i / Math.max(1, a.length - 1);
      const start: RGB = [dim[0] * 0.22, dim[1] * 0.22, dim[2] * 0.26];
      return t < 0.4 ? mix(start, verdigris, Math.pow(t / 0.4, 0.75))
           : t < 0.8 ? mix(verdigris, ember, (t - 0.4) / 0.4)
                     : mix(ember, verdigris, (t - 0.8) / 0.2);
    });

    const layers: Array<{ data: Float32Array; count: number; wide: number; core: number; alpha: number }> = [];
    const addCurve = (pts: Array<[number, number]>, z: number, cols: RGB[], weight: number) => {
      if (pts.length < 2) return;
      layers.push({ data: ribbonBuffer(pts, z, cols), count: pts.length * 2, wide: weight * 7, core: weight, alpha: 1 });
    };
    addCurve(curves.ceiling, Z.ceiling, curves.ceiling.map(() => rust), 0.0075);
    addCurve(curves.floor, Z.floor, curves.floor.map(() => verdigris), 0.0068);
    addCurve(curves.price, Z.price, priceColours, 0.0125);

    const vaos = layers.map((l) => {
      const vao = gl.createVertexArray()!;
      const buf = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, l.data, gl.STATIC_DRAW);
      const S = 40;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, S, 24);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, S, 28);
      return { vao, buf, ...l };
    });

    /* The ground. Lines running away from the eye are what make a flat screen
       read as a room, and every reference for this look is built on one. */
    const GY = -0.92, ZN = -3.2, ZF = 1.6;
    const gridSegs: Array<[number[], number[]]> = [];
    for (let i = 0; i <= 30; i++) {
      const x = -3.0 + (i / 30) * 6.0;
      gridSegs.push([[x, GY, ZN], [x, GY, ZF]]);
    }
    for (let i = 0; i <= 18; i++) {
      // Squared toward the horizon, so the spacing tightens with distance the
      // way it does on a real surface instead of marching evenly away.
      const t = i / 18;
      const z = ZN + (1 - (1 - t) * (1 - t)) * (ZF - ZN);
      gridSegs.push([[-3.0, GY, z], [3.0, GY, z]]);
    }
    const gridData = segmentsToRibbon(gridSegs, mix(verdigris, dim, 0.45));
    const gridCount = gridSegs.length * 6;
    const gridVao = gl.createVertexArray()!;
    const gridBuf = gl.createBuffer()!;
    gl.bindVertexArray(gridVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
    gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW);
    for (const [loc, size, off] of [[0,3,0],[1,3,12],[2,1,24],[3,3,28]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off);
    }
    gl.bindVertexArray(null);

    /* The interventions, standing in front of the price they interrupted, and
       a stem down to the curve so it is clear which point each one belongs to. */
    const statusColour = (s: string): RGB =>
      s === 'refused' ? rust : s === 'trimmed' ? amber : verdigris;

    const mData = new Float32Array(markers.length * 7);
    markers.forEach((m, i) => {
      const w = toWorld(m.cx, m.cy, Z.marks);
      const c = statusColour(m.status);
      const o = i * 7;
      mData[o] = w[0]; mData[o + 1] = w[1]; mData[o + 2] = w[2];
      mData[o + 3] = c[0]; mData[o + 4] = c[1]; mData[o + 5] = c[2];
      mData[o + 6] = (m.id === selectedId ? 68 : 44) * (m.r ? m.r / 6.5 : 1);
    });
    const mVao = gl.createVertexArray()!;
    const mBuf = gl.createBuffer()!;
    gl.bindVertexArray(mVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);

    /* Stems from each marker down to the curve it interrupted, so it is clear
       which point on the price each intervention belongs to. */
    const stemSegs: Array<[number[], number[]]> = markers.map((m) => [
      [...toWorld(m.cx, m.cy, Z.marks)], [...toWorld(m.cx, m.cy, Z.price)],
    ]);
    const stemData = segmentsToRibbon(stemSegs, mix(dim, verdigris, 0.4));
    const stemCount = stemSegs.length * 6;
    const stemVao = gl.createVertexArray()!;
    const stemBuf = gl.createBuffer()!;
    gl.bindVertexArray(stemVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, stemBuf);
    gl.bufferData(gl.ARRAY_BUFFER, stemData, gl.STATIC_DRAW);
    for (const [loc, size, off] of [[0,3,0],[1,3,12],[2,1,24],[3,3,28]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off);
    }
    gl.bindVertexArray(null);

    /* Depth haze. Atmosphere, not data, and it says nothing about anything. */
    const DUST = 90;
    const dust = new Float32Array(DUST * 7);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < DUST; i++) {
      const o = i * 7;
      dust[o] = (rnd() - 0.5) * 5.2;
      dust[o + 1] = -0.9 + rnd() * 2.0;
      dust[o + 2] = -3.2 + rnd() * 4.8;
      const c = mix(verdigris, ember, rnd());
      dust[o + 3] = c[0]; dust[o + 4] = c[1]; dust[o + 5] = c[2];
      dust[o + 6] = 6 + rnd() * 12;
    }
    const dVao = gl.createVertexArray()!;
    const dBuf = gl.createBuffer()!;
    gl.bindVertexArray(dVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, dBuf);
    gl.bufferData(gl.ARRAY_BUFFER, dust, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindVertexArray(null);

    const uR = {
      mvp: gl.getUniformLocation(ribbonProg, 'uMvp'),
      aspect: gl.getUniformLocation(ribbonProg, 'uAspect'),
      half: gl.getUniformLocation(ribbonProg, 'uHalf'),
      alpha: gl.getUniformLocation(ribbonProg, 'uAlpha'),
      soft: gl.getUniformLocation(ribbonProg, 'uSoft'),
    };
    const uP = {
      mvp: gl.getUniformLocation(pointProg, 'uMvp'),
      scale: gl.getUniformLocation(pointProg, 'uScale'),
      core: gl.getUniformLocation(pointProg, 'uCore'),
    };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
      const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      needsPaint.current = true;
    };
    resize();

    gl.enable(gl.BLEND);
    // Straight additive. Overlapping light adds, which is what makes the
    // crossings burn where the curves pass through one another.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    let raf = 0, visible = true;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      // Redraw every frame while it is on screen rather than only when
      // something moved. A canvas without a preserved drawing buffer shows
      // nothing on any recomposite that lands between draws, which is a blank
      // panel on a screenshot, sometimes on a scroll, and on whatever else the
      // compositor decides to do. Three draw calls and fifteen hundred
      // vertices are not worth defending against with a dirty flag, and the
      // real saving is already here: nothing runs while this is off screen or
      // the tab is in the background.
      if (!visible) return;

      const aspect = canvas.width / Math.max(1, canvas.height);
      const proj = perspective((42 * Math.PI) / 180, aspect, 0.1, 40);
      const view = multiply(
        multiply(rotateX((angles.current.x * Math.PI) / 180),
                 rotateY((angles.current.y * Math.PI) / 180)),
        translate(0, 0.06, -4.45),
      );
      const mvp = multiply(view, proj);
      mvpRef.current = mvp;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(ribbonProg);
      gl.uniformMatrix4fv(uR.mvp, false, mvp);
      gl.uniform1f(uR.aspect, aspect);

      // Ground first, faint, so everything else sits above it.
      gl.bindVertexArray(gridVao);
      gl.uniform1f(uR.half, 0.0055);
      gl.uniform1f(uR.alpha, 0.5);
      gl.uniform1f(uR.soft, 0.8);
      gl.drawArrays(gl.TRIANGLES, 0, gridCount);

      gl.bindVertexArray(stemVao);
      gl.uniform1f(uR.half, 0.0042);
      gl.uniform1f(uR.alpha, 0.7);
      gl.drawArrays(gl.TRIANGLES, 0, stemCount);

      // Each curve twice: a wide soft pass for the glow, a narrow bright core.
      for (const l of vaos) {
        gl.bindVertexArray(l.vao);
        gl.uniform1f(uR.half, l.wide);
        gl.uniform1f(uR.alpha, 0.5);
        gl.uniform1f(uR.soft, 1.7);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, l.count);
        gl.uniform1f(uR.half, l.core);
        gl.uniform1f(uR.alpha, 1.35);
        gl.uniform1f(uR.soft, 0.5);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, l.count);
      }

      gl.useProgram(pointProg);
      gl.uniformMatrix4fv(uP.mvp, false, mvp);
      gl.uniform1f(uP.scale, dpr);
      gl.bindVertexArray(dVao);
      gl.uniform1f(uP.core, 0.25);
      gl.drawArrays(gl.POINTS, 0, DUST);
      gl.bindVertexArray(mVao);
      gl.uniform1f(uP.core, 0.55);
      gl.drawArrays(gl.POINTS, 0, markers.length);
      gl.bindVertexArray(null);
    };
    raf = requestAnimationFrame(draw);

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting; if (visible) needsPaint.current = true;
    }, { threshold: 0.01 });
    io.observe(canvas);
    const onVis = () => { visible = !document.hidden; needsPaint.current = true; };
    document.addEventListener('visibilitychange', onVis);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      for (const l of vaos) { gl.deleteBuffer(l.buf); gl.deleteVertexArray(l.vao); }
      gl.deleteBuffer(gridBuf); gl.deleteVertexArray(gridVao);
      gl.deleteBuffer(stemBuf); gl.deleteVertexArray(stemVao);
      gl.deleteBuffer(mBuf); gl.deleteVertexArray(mVao);
      gl.deleteBuffer(dBuf); gl.deleteVertexArray(dVao);
      gl.deleteProgram(ribbonProg); gl.deleteProgram(pointProg);
      if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [active, curves, markers, selectedId]);

  if (!active) return null;
  if (failed) {
    return (
      <div className="chart-mesh-empty" role="note">
        This device will not draw the turned view. The chart above it is the same
        data and needs nothing but a screen.
      </div>
    );
  }

  return (
    <div className="chart-mesh">
      <canvas
        ref={canvasRef}
        className="chart-mesh-canvas"
        role="application"
        aria-label="The chart in three dimensions. Drag or use the arrow keys to turn it, Escape to reset, tap an intervention to read it."
        tabIndex={0}
        onPointerDown={tilt.onPointerDown}
        onPointerMove={tilt.onPointerMove}
        onPointerUp={tilt.onPointerUp}
        onPointerCancel={tilt.onPointerUp}
        onKeyDown={tilt.onKeyDown}
        onDoubleClick={tilt.reset}
        onClick={(e) => pick(e.clientX, e.clientY)}
      />
      <div className="chart-mesh-hint" aria-hidden="true">
        drag to turn · double tap to reset
      </div>
    </div>
  );
};
