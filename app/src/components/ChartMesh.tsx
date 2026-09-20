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
  /** Turns a y in the chart's own coordinates into the price it stands for. */
  priceAt?: (svgY: number) => number;
}

type Series = 'ceiling' | 'price' | 'floor';

/** What the scrub found, in the chart's own units, not invented. */
interface Scrub {
  i: number;
  price: number | null;
  ceiling: number | null;
  floor: number | null;
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
/** The GLSL one, because the camera maths needs it on this side too. */
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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
layout(location = 4) in float aT;
uniform mat4 uMvp;
uniform float uAspect;
uniform float uHalf;
out vec3 vColour;
out float vEdge;
out float vDepth;
out float vT;
void main() {
  vec4 c0 = uMvp * vec4(aPos, 1.0);
  vec4 c1 = uMvp * vec4(aNext, 1.0);
  // A vertex at or behind the eye divides by something near zero, and the
  // width offset is then multiplied by that same w, so one grid line swinging
  // past the camera used to blow up into a quad the size of the screen. That
  // is what "the grid blocks the view" actually was. Keep w off the floor.
  float w0 = max(c0.w, 0.06);
  float w1 = max(c1.w, 0.06);
  vec2 n0 = c0.xy / w0;
  vec2 n1 = c1.xy / w1;
  vec2 dir = n1 - n0;
  if (length(dir) < 1e-6) dir = vec2(1.0, 0.0);
  dir = normalize(dir * vec2(uAspect, 1.0));
  vec2 nrm = vec2(-dir.y, dir.x) / vec2(uAspect, 1.0);
  gl_Position = vec4(c0.xy + nrm * uHalf * aSide * w0, c0.z, c0.w);
  vColour = aColour;
  vEdge = aSide;
  vDepth = c0.w;
  vT = aT;
}`;

const RIBBON_FS = `#version 300 es
precision highp float;
in vec3 vColour;
in float vEdge;
in float vDepth;
in float vT;
uniform float uAlpha;
uniform float uSoft;
uniform float uReveal;
uniform float uFlow;
uniform float uTime;
uniform float uTonemap;
out vec4 outColour;
void main() {
  // Drawn in from the left when the view opens, so the curve arrives rather
  // than simply being there. The shoulder keeps the leading edge from looking
  // cut off.
  float born = smoothstep(uReveal, uReveal - 0.07, vT);
  if (born <= 0.001) discard;

  // Soft shoulders make the wide pass read as glow rather than as a fat line.
  float a = pow(1.0 - abs(vEdge), uSoft) * born;
  // Air swallows light exponentially rather than in a straight line, and the
  // far end of a curve recedes properly once it is modelled that way.
  float fog = clamp(exp(-max(vDepth - 2.6, 0.0) * 0.42), 0.12, 1.0);

  // A light running along the curve the way time runs. It carries no number
  // and claims nothing. It says this is a series and it has a direction,
  // which a still line does not.
  float head = fract(vT - uTime * 0.09);
  float pulse = exp(-pow((head - 0.5) * 7.0, 2.0)) * uFlow;

  // Capped per fragment. At a sharp peak the strip doubles back on itself and
  // three passes of three curves land in the same pixels, and an unbounded sum
  // of a teal, an amber and a red is grey. That is the white spot: not a
  // highlight, an overflow. Bloom carries the sense of brightness instead.
  float v = min(a * uAlpha * fog * (1.0 + pulse * 1.9), 1.15);
  vec3 lit = vColour * v;
  // Rolled off here only when drawing straight to the canvas. With a float
  // target the highlights have to survive intact, because their overshoot is
  // exactly what the bloom pass is looking for.
  if (uTonemap > 0.5) lit = lit / (1.0 + lit);
  outColour = vec4(lit, min(v, 1.0));
}`;

const POINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColour;
layout(location = 2) in float aSize;
uniform mat4 uMvp;
uniform float uScale;
uniform float uPulse;
uniform float uTime;
uniform float uLife;
out vec3 vColour;
out float vDepth;
out float vSize;
void main() {
  vec4 c = uMvp * vec4(aPos, 1.0);
  gl_Position = c;
  // Golden angle off the vertex index, so no two markers are in step and the
  // field never reads as one blinking thing.
  float phase = float(gl_VertexID) * 2.39996;
  float own = 1.0 + sin(uTime * 1.1 + phase) * 0.05 * uLife;
  float sz = clamp(uScale * aSize * uPulse * own / max(c.w, 0.25), 2.0, 72.0);
  gl_PointSize = sz;
  vColour = aColour;
  vDepth = c.w;
  vSize = sz;
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vColour;
in float vDepth;
in float vSize;
uniform float uCore;
uniform float uGain;
uniform float uTonemap;
out vec4 outColour;
void main() {
  float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (r > 1.0) discard;
  // A bright centre inside a wide falloff, which is what a light looks like.
  // Bigger means nearer, and nearer means further out of focus, so the edge
  // softens as the sprite grows. That is most of a depth of field read for
  // the ambient layer without a blur pass anywhere.
  float soft = mix(4.0, 1.5, clamp(vSize / 40.0, 0.0, 1.0));
  float halo = pow(1.0 - r, soft);
  float core = smoothstep(uCore, uCore * 0.35, r);
  float fog = clamp(exp(-max(vDepth - 2.6, 0.0) * 0.42), 0.12, 1.0);
  float a = clamp(halo * 0.7 + core * 1.1, 0.0, 1.25) * fog * uGain;
  vec3 lit = vColour * a;
  if (uTonemap > 0.5) lit = lit / (1.0 + lit);
  outColour = vec4(lit, min(a, 1.0));
}`;

/**
 * Light that spreads onto its neighbours, which is the difference between a
 * glow and a bloom.
 *
 * Everything so far has been a shape with a soft edge. A bright marker could
 * not throw light onto the curve behind it or onto the haze, because each
 * shape only ever wrote inside its own geometry. That is what reads as faint.
 *
 * So the scene goes into a float target, gets downsampled and blurred a few
 * times, and comes back added on top. Dual filtering rather than a wide
 * gaussian: a handful of cheap small kernel passes at shrinking resolution,
 * which is what mobile games use because it costs a fraction of the fill rate
 * for a wider spread.
 */
const QUAD_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // One oversized triangle rather than two triangles, so there is no seam
  // along the diagonal and one fewer vertex to think about.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 outColour;
void main() {
  // Four diagonal taps, the standard dual filter downsample.
  vec3 c = texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  // Only on the first step: keep what is brighter than the scene generally is,
  // so the bloom comes off the hot parts rather than lifting everything.
  if (uThreshold > 0.0) {
    float l = max(max(c.r, c.g), c.b);
    c *= smoothstep(uThreshold, uThreshold * 2.2, l);
  }
  outColour = vec4(c, 1.0);
}`;

const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 outColour;
void main() {
  // Eight taps on the way back up, which is what widens the spread.
  vec3 c = texture(uTex, vUv + uTexel * vec2(-2.0, 0.0)).rgb
         + texture(uTex, vUv + uTexel * vec2( 2.0, 0.0)).rgb
         + texture(uTex, vUv + uTexel * vec2( 0.0,-2.0)).rgb
         + texture(uTex, vUv + uTexel * vec2( 0.0, 2.0)).rgb;
  c += 2.0 * (texture(uTex, vUv + uTexel * vec2(-1.0,-1.0)).rgb
            + texture(uTex, vUv + uTexel * vec2( 1.0,-1.0)).rgb
            + texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb
            + texture(uTex, vUv + uTexel * vec2( 1.0, 1.0)).rgb);
  outColour = vec4(c / 12.0, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uStrength;
uniform float uExposure;
out vec4 outColour;
void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 c = (scene + bloom * uStrength) * uExposure;

  // Darker toward the corners, which keeps the eye in the middle and hides
  // the edge of a scene that has no walls.
  vec2 d = vUv - 0.5;
  c *= 1.0 - smoothstep(0.30, 0.82, dot(d, d) * 2.0) * 0.4;

  // Roll the highlights off on brightness alone rather than per channel.
  // Reinhard applied to r, g and b separately pulls every bright colour
  // toward white, which is how a verdigris curve ends up looking grey. Scale
  // the colour by how much its own luminance had to give up and the hue
  // survives the compression.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (l > 0.0001) c *= (l / (1.0 + l)) / l;

  float a = clamp(max(max(c.r, c.g), c.b) * 2.4, 0.0, 1.0);
  outColour = vec4(c, a);
}`;

/**
 * The ring a tap throws off.
 *
 * On a phone there is no cursor and no hover, so the only way to know a tap
 * landed is for something to happen where the finger was. This is that: an
 * annulus on the selected marker that expands once and fades, drawn through
 * the bloom so it throws light onto whatever it passes.
 */
const RING_FS = `#version 300 es
precision highp float;
in vec3 vColour;
in float vDepth;
in float vSize;
uniform float uCore;
uniform float uGain;
uniform float uTonemap;
out vec4 outColour;
void main() {
  float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (r > 1.0) discard;
  // uCore carries how far out the ring has travelled, 0 to 1.
  float band = exp(-pow((r - uCore) * 7.0, 2.0));
  float a = band * uGain;
  vec3 lit = vColour * a;
  if (uTonemap > 0.5) lit = lit / (1.0 + lit);
  outColour = vec4(lit, min(a, 1.0));
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
  const data = new Float32Array(n * 2 * 11);
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
      const o = (i * 2 + (side === 1 ? 1 : 0)) * 11;
      data[o] = cur[0]; data[o + 1] = cur[1]; data[o + 2] = cur[2];
      data[o + 3] = nxt[0]; data[o + 4] = nxt[1]; data[o + 5] = nxt[2];
      data[o + 6] = side;
      data[o + 7] = col[0]; data[o + 8] = col[1]; data[o + 9] = col[2];
      data[o + 10] = i / Math.max(1, n - 1);
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
  const data = new Float32Array(segs.length * 6 * 11);
  let o = 0;
  const put = (p: number[], nx: number[], side: number) => {
    data[o] = p[0]; data[o + 1] = p[1]; data[o + 2] = p[2];
    data[o + 3] = nx[0]; data[o + 4] = nx[1]; data[o + 5] = nx[2];
    data[o + 6] = side;
    data[o + 7] = colour[0]; data[o + 8] = colour[1]; data[o + 9] = colour[2];
    data[o + 10] = 0;
    o += 11;
  };
  for (const [a, b] of segs) {
    const beyond = [2 * b[0] - a[0], 2 * b[1] - a[1], 2 * b[2] - a[2]];
    put(a, b, -1); put(a, b, 1); put(b, beyond, -1);
    put(a, b, 1); put(b, beyond, 1); put(b, beyond, -1);
  }
  return data;
}

export const ChartMesh: React.FC<Props> = ({
  active, trajectoryPath, ceilingPath, floorPath, markers, onPickMarker, selectedId, priceAt,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  /** Flipped on one frame after mount, so the opacity transition has a start. */
  const [shown, setShown] = useState(false);
  const [isolated, setIsolated] = useState<Series | null>(null);
  const [scrub, setScrub] = useState<Scrub | null>(null);
  const scrubRef = useRef<Scrub | null>(null);
  scrubRef.current = scrub;
  const isolatedRef = useRef<Series | null>(null);
  isolatedRef.current = isolated;
  useEffect(() => {
    if (!active) { setShown(false); return; }
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [active]);
  const angles = useRef<Tilt>({ x: 24, y: -30 });
  const mvpRef = useRef<M4>(identity());
  const needsPaint = useRef(true);

  /** Set on the first real gesture, which permanently ends the idle drift. */
  const touched = useRef(false);
  /** Wall clock of the last thing worth lighting up, for the one shot flow. */
  const flowAt = useRef(-99);

  const onTilt = useCallback((t: Tilt) => {
    angles.current = t;
    touched.current = true;
    needsPaint.current = true;
  }, []);
  const tilt = useTilt3D(active, { onTilt, cssTransform: false, maxX: 88 });

  const curvesRef = useRef<{ price: Array<[number, number]>; ceiling: Array<[number, number]>; floor: Array<[number, number]> } | null>(null);
  const priceAtRef = useRef(priceAt);
  priceAtRef.current = priceAt;

  const curves = useMemo(() => {
    if (!active) return null;
    return {
      price: samplePath(trajectoryPath),
      ceiling: samplePath(ceilingPath ?? ''),
      floor: samplePath(floorPath ?? ''),
    };
  }, [active, trajectoryPath, ceilingPath, floorPath]);
  curvesRef.current = curves;

  /** Where a press began, so a turn does not end in a selection. */
  const press = useRef<{ x: number; y: number; t: number; coarse: boolean } | null>(null);
  const dragging = useRef(false);

  const pick = useCallback((cx: number, cy: number, coarse: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas || markers.length === 0) return;
    const r = canvas.getBoundingClientRect();
    const nx = ((cx - r.left) / r.width) * 2 - 1;
    const ny = -(((cy - r.top) / r.height) * 2 - 1);
    let best: ChartMarker | null = null;
    // A fingertip is about nine millimetres across and a mouse pointer is one
    // pixel, so they do not get the same target.
    let bestD = coarse ? 0.17 : 0.09;
    for (const m of markers) {
      const w = toWorld(m.cx, m.cy, Z.marks);
      const p = project(mvpRef.current, w[0], w[1], w[2]);
      if (p.w <= 0) continue;
      const d = Math.hypot(p.x - nx, p.y - ny);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best) {
      tactile.selectionTap();
      // A light runs from the marker along the curve it interrupted, and a
      // ring goes out from where the finger landed. Once, on the tap, rather
      // than for ever: a band travelling a price line without being asked
      // reads as the price moving, and nothing here is live.
      flowAt.current = performance.now();
      onPickMarker?.(best);
    }
  }, [markers, onPickMarker]);

  /* A drag that ends on a marker is still a drag. Without this, turning the
     scene on a phone selects whatever happened to be under the finger when it
     lifted, which is the most annoying possible behaviour. */
  const onDown = useCallback((e: React.PointerEvent) => {
    press.current = { x: e.clientX, y: e.clientY, t: performance.now(), coarse: e.pointerType !== 'mouse' };
    dragging.current = false;
    tilt.onPointerDown(e);
  }, [tilt]);

  /**
   * Read the three curves at one moment in time.
   *
   * This is the interaction that is genuinely better here than flat. The
   * ceiling, the price and the floor sit on separate planes precisely so they
   * stop overlapping, and reading all three at the same instant is the
   * question the separation exists to answer: where is the price relative to
   * both of its boundaries right now.
   *
   * It snaps to a sample that already exists rather than interpolating one, so
   * the number is a point on the curve and not something worked out about it.
   */
  const doScrub = useCallback((cx: number, cy: number) => {
    const canvas = canvasRef.current;
    const c = curvesRef.current;
    if (!canvas || !c || c.price.length === 0) return;
    const r = canvas.getBoundingClientRect();
    const nx = ((cx - r.left) / r.width) * 2 - 1;
    const ny = -(((cy - r.top) / r.height) * 2 - 1);
    let bi = -1, bd = 0.22;
    for (let i = 0; i < c.price.length; i++) {
      const w = toWorld(c.price[i][0], c.price[i][1], Z.price);
      const p = project(mvpRef.current, w[0], w[1], w[2]);
      if (p.w <= 0) continue;
      const d = Math.hypot(p.x - nx, p.y - ny);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0) { setScrub(null); return; }
    const at = (arr: Array<[number, number]>) =>
      arr.length ? (priceAtRef.current?.(arr[Math.min(bi, arr.length - 1)][1]) ?? null) : null;
    setScrub({ i: bi, price: at(c.price), ceiling: at(c.ceiling), floor: at(c.floor) });
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    const p0 = press.current;
    if (p0 && Math.hypot(e.clientX - p0.x, e.clientY - p0.y) > 7) dragging.current = true;
    tilt.onPointerMove(e);
    // Hovering reads the curves. Dragging turns them. A finger can only do one
    // at a time, so on touch the read happens on the tap instead.
    if (!dragging.current && e.pointerType === 'mouse') doScrub(e.clientX, e.clientY);
  }, [tilt, doScrub]);

  const onUp = useCallback((e: React.PointerEvent) => {
    const p0 = press.current;
    tilt.onPointerUp(e);
    press.current = null;
    if (!p0 || dragging.current) return;
    if (performance.now() - p0.t > 600) return;
    if (p0.coarse) doScrub(e.clientX, e.clientY);
    pick(e.clientX, e.clientY, p0.coarse);
  }, [tilt, pick, doScrub]);

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

    /* The post chain. Optional on purpose: if a device will not give us a
       float target we draw straight to the canvas and tonemap in place, which
       loses the spread but keeps the picture. */
    const hdr = gl.getExtension('EXT_color_buffer_float');
    const ringProg = compile(gl, POINT_VS, RING_FS);
    const downProg = hdr ? compile(gl, QUAD_VS, DOWN_FS) : null;
    const upProg = hdr ? compile(gl, QUAD_VS, UP_FS) : null;
    const compProg = hdr ? compile(gl, QUAD_VS, COMPOSITE_FS) : null;
    const post = !!(downProg && upProg && compProg);
    const quadVao = gl.createVertexArray()!;

    type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };
    const targets: Target[] = [];
    const makeTarget = (w: number, h: number): Target => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb, tex, w, h };
    };
    const disposeTargets = () => {
      for (const t of targets) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
      targets.length = 0;
    };
    /** Full size for the scene, then three halvings for the blur chain. */
    const buildTargets = (w: number, h: number) => {
      disposeTargets();
      let cw = w, ch = h;
      for (let i = 0; i < 4; i++) {
        targets.push(makeTarget(Math.max(2, cw), Math.max(2, ch)));
        cw = Math.max(2, cw >> 1); ch = Math.max(2, ch >> 1);
      }
    };

    const uD = downProg ? {
      tex: gl.getUniformLocation(downProg, 'uTex'),
      texel: gl.getUniformLocation(downProg, 'uTexel'),
      threshold: gl.getUniformLocation(downProg, 'uThreshold'),
    } : null;
    const uU = upProg ? {
      tex: gl.getUniformLocation(upProg, 'uTex'),
      texel: gl.getUniformLocation(upProg, 'uTexel'),
    } : null;
    const uC = compProg ? {
      scene: gl.getUniformLocation(compProg, 'uScene'),
      bloom: gl.getUniformLocation(compProg, 'uBloom'),
      strength: gl.getUniformLocation(compProg, 'uStrength'),
      exposure: gl.getUniformLocation(compProg, 'uExposure'),
    } : null;

    const verdigris = cssRgb('--mesh-price', [0.31, 0.76, 0.65]);
    const ember = cssRgb('--mesh-ember', [0.91, 0.55, 0.23]);
    const rust = cssRgb('--mesh-rust', [0.79, 0.31, 0.23]);
    const amber = cssRgb('--mesh-amber', [0.85, 0.65, 0.23]);
    const dim = cssRgb('--mesh-haze', [0.45, 0.45, 0.44]);

    /* The price carries the same gradient the flat chart uses, so the eye
       recognises it as the same object rather than a second drawing. */
    const priceColours = curves.price.map((_, i, a) => {
      const t = i / Math.max(1, a.length - 1);
      const start: RGB = [dim[0] * 0.22, dim[1] * 0.22, dim[2] * 0.26];
      return t < 0.4 ? mix(start, verdigris, Math.pow(t / 0.4, 0.75))
           : t < 0.8 ? mix(verdigris, ember, (t - 0.4) / 0.4)
                     : mix(ember, verdigris, (t - 0.8) / 0.2);
    });

    const layers: Array<{ data: Float32Array; count: number; wide: number; core: number; alpha: number; name: Series }> = [];
    const addCurve = (name: Series, pts: Array<[number, number]>, z: number, cols: RGB[], weight: number) => {
      if (pts.length < 2) return;
      layers.push({ name, data: ribbonBuffer(pts, z, cols), count: pts.length * 2, wide: weight * 7, core: weight, alpha: 1 });
    };
    addCurve('ceiling', curves.ceiling, Z.ceiling, curves.ceiling.map(() => rust), 0.0075);
    addCurve('floor', curves.floor, Z.floor, curves.floor.map(() => verdigris), 0.0068);
    addCurve('price', curves.price, Z.price, priceColours, 0.0125);

    const vaos = layers.map((l) => {
      const vao = gl.createVertexArray()!;
      const buf = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, l.data, gl.STATIC_DRAW);
      const S = 44;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, S, 24);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, S, 28);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, S, 40);
      return { vao, buf, ...l };
    });

    /* The ground. Lines running away from the eye are what make a flat screen
       read as a room, and every reference for this look is built on one. */
    // Bound to what the data occupies rather than to the viewport. The old
    // plane ran to x = 3 and z = 1.6 against a camera 4.45 away, so turning it
    // swung lines through the near plane. Half the density too: this is an
    // anchor for the eye near the resting angle, not a surface that has to
    // survive being looked at from every side.
    const GY = -0.86, ZN = -1.9, ZF = 0.9;
    const gridSegs: Array<[number[], number[]]> = [];
    for (let i = 0; i <= 14; i++) {
      const x = -1.6 + (i / 14) * 3.2;
      gridSegs.push([[x, GY, ZN], [x, GY, ZF]]);
    }
    for (let i = 0; i <= 9; i++) {
      // Squared toward the horizon, so the spacing tightens with distance the
      // way it does on a real surface instead of marching evenly away.
      const t = i / 9;
      const z = ZN + (1 - (1 - t) * (1 - t)) * (ZF - ZN);
      gridSegs.push([[-1.6, GY, z], [1.6, GY, z]]);
    }
    // Subordinate on purpose. It is a horizon for the eye to sit on, and the
    // depth work is done by the fog, the parallax and the bloom.
    const gridData = segmentsToRibbon(gridSegs, mix(verdigris, dim, 0.62));
    const gridCount = gridSegs.length * 6;
    const gridVao = gl.createVertexArray()!;
    const gridBuf = gl.createBuffer()!;
    gl.bindVertexArray(gridVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
    gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW);
    for (const [loc, size, off] of [[0,3,0],[1,3,12],[2,1,24],[3,3,28],[4,1,40]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 44, off);
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

    /* The selected marker on its own, for the tap ring. */
    const sel = markers.find((m) => m.id === selectedId) ?? null;
    const selData = new Float32Array(7);
    if (sel) {
      const w = toWorld(sel.cx, sel.cy, Z.marks);
      const c = sel.status === 'refused' ? rust : sel.status === 'trimmed' ? amber : verdigris;
      selData.set([w[0], w[1], w[2], c[0], c[1], c[2], 150]);
    }
    const selVao = gl.createVertexArray()!;
    const selBuf = gl.createBuffer()!;
    gl.bindVertexArray(selVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, selBuf);
    gl.bufferData(gl.ARRAY_BUFFER, selData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindVertexArray(null);

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
    for (const [loc, size, off] of [[0,3,0],[1,3,12],[2,1,24],[3,3,28],[4,1,40]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 44, off);
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
      reveal: gl.getUniformLocation(ribbonProg, 'uReveal'),
      flow: gl.getUniformLocation(ribbonProg, 'uFlow'),
      time: gl.getUniformLocation(ribbonProg, 'uTime'),
      tonemap: gl.getUniformLocation(ribbonProg, 'uTonemap'),
    };
    const uRing = ringProg ? {
      mvp: gl.getUniformLocation(ringProg, 'uMvp'),
      scale: gl.getUniformLocation(ringProg, 'uScale'),
      pulse: gl.getUniformLocation(ringProg, 'uPulse'),
      time: gl.getUniformLocation(ringProg, 'uTime'),
      life: gl.getUniformLocation(ringProg, 'uLife'),
      core: gl.getUniformLocation(ringProg, 'uCore'),
      gain: gl.getUniformLocation(ringProg, 'uGain'),
      tonemap: gl.getUniformLocation(ringProg, 'uTonemap'),
    } : null;
    const uP = {
      mvp: gl.getUniformLocation(pointProg, 'uMvp'),
      scale: gl.getUniformLocation(pointProg, 'uScale'),
      core: gl.getUniformLocation(pointProg, 'uCore'),
      gain: gl.getUniformLocation(pointProg, 'uGain'),
      pulse: gl.getUniformLocation(pointProg, 'uPulse'),
      time: gl.getUniformLocation(pointProg, 'uTime'),
      life: gl.getUniformLocation(pointProg, 'uLife'),
      tonemap: gl.getUniformLocation(pointProg, 'uTonemap'),
    };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
      const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw; canvas.height = ch;
        if (post) buildTargets(cw, ch);
      }
      needsPaint.current = true;
    };
    if (post) buildTargets(Math.max(2, canvas.width), Math.max(2, canvas.height));
    resize();

    gl.enable(gl.BLEND);
    // Straight additive. Overlapping light adds, which is what makes the
    // crossings burn where the curves pass through one another.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const t0 = performance.now();
    // Opening the view draws the curves in along their length. Every reporting
    // tool on earth does this and nobody reads it as data arriving, which
    // makes it the one animation here with no honesty cost at all.
    const REVEAL_MS = reduced ? 0 : 850;
    // The camera arrives. It starts well back and comes in to its resting
    // distance, which is what makes opening the view feel like being pulled
    // into the scene rather than being shown a different picture of it.
    const DOLLY_MS = reduced ? 0 : 1500;
    const FAR = -11.5, NEAR = -4.45;

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

      const now = performance.now();
      const age = now - t0;
      const reveal = REVEAL_MS > 0 ? Math.min(1, age / REVEAL_MS) : 1;
      // Eased, so the curve arrives rather than being wiped on at a constant
      // rate, which always looks mechanical.
      const revealEased = 1 - Math.pow(1 - reveal, 3);

      // A few degrees of drift until the first touch, so there is something
      // moving before anybody does anything. It never comes back.
      const intro = !touched.current && !reduced
        ? Math.sin(age / 2600) * 7 - (age / 2600) * 1.6
        : 0;
      // And underneath that, a breath that never stops. Amplitudes small
      // enough that nobody catches it moving and large enough that the scene
      // is never quite still, which is most of the difference between a place
      // and a picture. Three periods that do not divide into each other, so it
      // never visibly repeats.
      const breathe = reduced ? 0 : 1;
      const drift = intro + breathe * Math.sin(now / 7300) * 1.25;
      const pitchBreath = breathe * Math.sin(now / 9700) * 0.75;
      const zBreath = breathe * Math.sin(now / 6100) * 0.055;

      const aspect = canvas.width / Math.max(1, canvas.height);
      const proj = perspective((42 * Math.PI) / 180, aspect, 0.1, 40);
      // Expo out: most of the travel happens immediately and it settles into
      // the last of it, which reads as momentum rather than as a slide.
      const dolly = DOLLY_MS > 0 ? Math.min(1, age / DOLLY_MS) : 1;
      const dollyEased = 1 - Math.pow(2, -10 * dolly);
      const camZ = FAR + (NEAR - FAR) * dollyEased + zBreath * dollyEased;
      // It also swings a little as it comes in, so the arrival has a direction.
      const swing = (1 - dollyEased) * 26;

      const camera = (yawScale: number) => multiply(
        multiply(rotateX(((angles.current.x + pitchBreath - swing * 0.5) * Math.PI) / 180),
                 rotateY(((angles.current.y + drift + swing) * yawScale * Math.PI) / 180)),
        translate(0, 0.06, camZ),
      );
      const mvp = multiply(camera(1), proj);
      mvpRef.current = mvp;
      // The haze turns at half the rate of the scene, so it visibly lags as
      // you drag. Parallax during the gesture that is meant to show depth is
      // worth more than any amount of idle movement.
      const dustMvp = multiply(
        multiply(
          multiply(rotateX(((angles.current.x + pitchBreath) * Math.PI) / 180),
                   rotateY((((angles.current.y + drift) * 0.5 + (breathe ? now / 260 * 0.012 : 0)) * Math.PI) / 180)),
          translate(0, 0.06, camZ),
        ), proj);

      const sinceFlow = (now - flowAt.current) / 1000;
      const flow = reduced ? 0
        : age < REVEAL_MS + 400 ? 1
        : sinceFlow < 1.4 ? 1 - sinceFlow / 1.4
        : 0;

      const sceneTarget = post ? targets[0] : null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget ? sceneTarget.fb : null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      gl.useProgram(ribbonProg);
      gl.uniform1f(uR.tonemap, post ? 0 : 1);
      gl.uniformMatrix4fv(uR.mvp, false, mvp);
      gl.uniform1f(uR.aspect, aspect);
      gl.uniform1f(uR.time, now / 1000);

      // The ground, faded by how steeply it is being looked through.
      //
      // The first attempt at this had it backwards. Seen edge on, at a pitch
      // near zero, the plane is a thin line and costs nothing. Turned toward
      // ninety it is underfoot and fills the frame, which is exactly the angle
      // somebody reaches for when they want to see the markers from above. So
      // it has to dissolve as the pitch grows, not arrive.
      const pitch = Math.abs(((angles.current.x + 180) % 360 + 360) % 360 - 180);
      // Faded by angle, and held back until the curves have arrived, so the
      // floor settles under a scene that already exists.
      const groundFade = (1 - smoothstep(48, 82, pitch)) * smoothstep(0.04, 0.45, revealEased);
      if (groundFade > 0.02) {
        gl.bindVertexArray(gridVao);
        gl.uniform1f(uR.half, 0.0045);
        gl.uniform1f(uR.alpha, 0.26 * groundFade);
        gl.uniform1f(uR.soft, 0.8);
        gl.uniform1f(uR.reveal, 2);
        gl.uniform1f(uR.flow, 0);
        gl.drawArrays(gl.TRIANGLES, 0, gridCount);
      }

      gl.bindVertexArray(stemVao);
      gl.uniform1f(uR.half, 0.0042);
      gl.uniform1f(uR.alpha, 0.7 * revealEased);
      gl.uniform1f(uR.reveal, 2);
      gl.uniform1f(uR.flow, 0);
      gl.drawArrays(gl.TRIANGLES, 0, stemCount);

      // Each curve twice: a wide soft pass for the glow, a narrow bright core.
      const solo = isolatedRef.current;
      for (const l of vaos) {
        // Ghosted rather than hidden. A comparison needs the thing you are
        // comparing against to still be somewhere on the screen.
        const iso = !solo || solo === l.name ? 1 : 0.13;
        gl.bindVertexArray(l.vao);
        gl.uniform1f(uR.reveal, revealEased);
        gl.uniform1f(uR.flow, flow * (iso > 0.5 ? 1 : 0));
        // A third, very wide, very dim pass. Not real bloom, it still cannot
        // spread onto anything but itself, but it buys reach for one call.
        gl.uniform1f(uR.half, l.wide * 2.3);
        gl.uniform1f(uR.alpha, 0.1 * iso);
        gl.uniform1f(uR.soft, 2.6);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, l.count);
        gl.uniform1f(uR.half, l.wide);
        gl.uniform1f(uR.alpha, 0.42 * iso);
        gl.uniform1f(uR.soft, 1.7);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, l.count);
        gl.uniform1f(uR.half, l.core);
        gl.uniform1f(uR.alpha, 0.95 * iso);
        gl.uniform1f(uR.soft, 0.5);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, l.count);
      }

      gl.useProgram(pointProg);
      gl.uniform1f(uP.tonemap, post ? 0 : 1);
      gl.uniform1f(uP.scale, dpr);
      gl.uniform1f(uP.time, now / 1000);
      gl.uniform1f(uP.life, reduced ? 0 : 1);
      // Haze on its own lagging camera.
      gl.uniformMatrix4fv(uP.mvp, false, dustMvp);
      gl.bindVertexArray(dVao);
      gl.uniform1f(uP.core, 0.25);
      // The haze is up almost at once. Something has to be there while the
      // curves are still drawing themselves, or the first frames are an empty
      // card, which is the flash this whole transition exists to remove.
      gl.uniform1f(uP.gain, 0.85 * smoothstep(0, 0.18, revealEased));
      gl.uniform1f(uP.pulse, 1);
      gl.drawArrays(gl.POINTS, 0, DUST);
      // The markers arrive after the curves they sit on.
      const markIn = smoothstep(0.55, 1, revealEased);
      gl.uniformMatrix4fv(uP.mvp, false, mvp);
      gl.bindVertexArray(mVao);
      gl.uniform1f(uP.core, 0.55);
      gl.uniform1f(uP.gain, markIn);
      // The selected one breathes. Only that one, because a field of pulsing
      // dots is decoration and a single one is an affordance.
      gl.uniform1f(uP.pulse, reduced ? 1 : 1 + Math.sin(now / 420) * 0.06);
      gl.drawArrays(gl.POINTS, 0, markers.length);

      // Where the scrub is reading, marked on all three curves at once.
      const sc = scrubRef.current;
      if (sc && ringProg && uRing && curves) {
        const at: Array<[Array<[number, number]>, number, RGB]> = [
          [curves.ceiling, Z.ceiling, rust],
          [curves.price, Z.price, verdigris],
          [curves.floor, Z.floor, verdigris],
        ];
        gl.useProgram(ringProg);
        gl.uniformMatrix4fv(uRing.mvp, false, mvp);
        gl.uniform1f(uRing.scale, dpr);
        gl.uniform1f(uRing.pulse, 1);
        gl.uniform1f(uRing.time, now / 1000);
        gl.uniform1f(uRing.life, 0);
        gl.uniform1f(uRing.tonemap, post ? 0 : 1);
        gl.uniform1f(uRing.core, 0.62);
        gl.uniform1f(uRing.gain, 1.1);
        const buf = new Float32Array(7);
        for (const [arr, z, col] of at) {
          if (!arr.length) continue;
          const pt = arr[Math.min(sc.i, arr.length - 1)];
          const w = toWorld(pt[0], pt[1], z);
          buf.set([w[0], w[1], w[2], col[0], col[1], col[2], 92]);
          gl.bindVertexArray(selVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, selBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf);
          gl.drawArrays(gl.POINTS, 0, 1);
        }
      }

      // The tap ring, while it is still travelling.
      const ringAge = (now - flowAt.current) / 700;
      if (sel && ringProg && uRing && ringAge >= 0 && ringAge < 1 && !reduced) {
        gl.useProgram(ringProg);
        gl.uniformMatrix4fv(uRing.mvp, false, mvp);
        gl.uniform1f(uRing.scale, dpr);
        gl.uniform1f(uRing.pulse, 1);
        gl.uniform1f(uRing.time, now / 1000);
        gl.uniform1f(uRing.life, 0);
        gl.uniform1f(uRing.tonemap, post ? 0 : 1);
        gl.uniform1f(uRing.core, 0.15 + ringAge * 0.85);
        gl.uniform1f(uRing.gain, (1 - ringAge) * 1.6);
        gl.bindVertexArray(selVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, selBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, selData);
        gl.drawArrays(gl.POINTS, 0, 1);
      }
      gl.bindVertexArray(null);

      if (!post || !uD || !uU || !uC) return;

      /* Down the chain, blurring as it shrinks, then back up, adding each
         level into the one above it. Blending is off for these: every pass
         writes its whole target. */
      gl.disable(gl.BLEND);
      gl.bindVertexArray(quadVao);
      gl.activeTexture(gl.TEXTURE0);

      gl.useProgram(downProg!);
      gl.uniform1i(uD.tex, 0);
      for (let i = 1; i < targets.length; i++) {
        const src = targets[i - 1], dst = targets[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(uD.texel, 1 / src.w, 1 / src.h);
        // Only the first step cuts the dim parts away, or each level would
        // threshold again and eat the spread it just created.
        gl.uniform1f(uD.threshold, i === 1 ? 0.55 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      gl.useProgram(upProg!);
      gl.uniform1i(uU.tex, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = targets.length - 1; i > 1; i--) {
        const src = targets[i], dst = targets[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(uU.texel, 1 / src.w, 1 / src.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(compProg!);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[0].tex);
      gl.uniform1i(uC.scene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, targets[1].tex);
      gl.uniform1i(uC.bloom, 1);
      // Light lifts while something is happening: brighter through a tap and
      // a little brighter while a finger is down. The scene answers rather
      // than sitting at one setting.
      const react = (ringAge >= 0 && ringAge < 1 ? (1 - ringAge) * 0.55 : 0)
                  + (dragging.current ? 0.18 : 0);
      gl.uniform1f(uC.strength, 0.9 + react);
      gl.uniform1f(uC.exposure, 2.35 + react * 0.35);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
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
      gl.deleteBuffer(selBuf); gl.deleteVertexArray(selVao);
      if (ringProg) gl.deleteProgram(ringProg);
      gl.deleteBuffer(dBuf); gl.deleteVertexArray(dVao);
      gl.deleteProgram(ribbonProg); gl.deleteProgram(pointProg);
      if (downProg) gl.deleteProgram(downProg);
      if (upProg) gl.deleteProgram(upProg);
      if (compProg) gl.deleteProgram(compProg);
      gl.deleteVertexArray(quadVao);
      disposeTargets();
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
    <div className={`chart-mesh ${shown ? "is-in" : ""}`}>
      <canvas
        ref={canvasRef}
        className="chart-mesh-canvas"
        role="application"
        aria-label="The chart in three dimensions. Drag or use the arrow keys to turn it, Escape to reset, tap an intervention to read it."
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={(e) => { press.current = null; tilt.onPointerUp(e); }}
        onKeyDown={tilt.onKeyDown}
        onDoubleClick={tilt.reset}
      />
      <div className="chart-mesh-hint" aria-hidden="true">
        drag to turn · double tap to reset
      </div>

      <div className="mesh-tools" role="group" aria-label="Read and compare">
        {(['ceiling', 'price', 'floor'] as Series[]).map((k) => (
          <button
            key={k}
            type="button"
            className="mesh-chip"
            aria-pressed={isolated === k}
            onClick={() => setIsolated(isolated === k ? null : k)}
            title={isolated === k ? 'Show all three again' : `Compare against ${k} alone`}
          >
            {k === 'ceiling' ? 'Ceiling' : k === 'price' ? 'Price' : 'Floor'}
          </button>
        ))}
        <span className="spacer" />
        {([
          ['Front', 0, 0],
          ['Side', 8, -68],
          ['Above', 78, -18],
        ] as Array<[string, number, number]>).map(([label, x, y]) => (
          <button
            key={label}
            type="button"
            className="mesh-chip"
            onClick={() => tilt.to(x, y)}
            title={`Turn to the ${label.toLowerCase()} view`}
          >
            {label}
          </button>
        ))}
      </div>

      {scrub && (
        <div className="mesh-readout" role="status">
          <div className="row">
            <span>Reading all three at one moment</span>
            <button
              type="button"
              className="text-[var(--text-tertiary)] underline underline-offset-2"
              onClick={() => setScrub(null)}
            >
              clear
            </button>
          </div>
          {scrub.ceiling !== null && (
            <div className="row">
              <span>Ceiling</span><b>${scrub.ceiling.toFixed(2)}</b>
            </div>
          )}
          {scrub.price !== null && (
            <div className="row">
              <span>Price</span><b>${scrub.price.toFixed(2)}</b>
            </div>
          )}
          {scrub.floor !== null && (
            <div className="row">
              <span>Floor</span><b>${scrub.floor.toFixed(2)}</b>
            </div>
          )}
          {scrub.price !== null && scrub.ceiling !== null && (
            <div className="row">
              <span>Room under the ceiling</span>
              <b>${(scrub.ceiling - scrub.price).toFixed(2)}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
