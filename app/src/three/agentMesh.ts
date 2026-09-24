import * as THREE from 'three';
import {
  BUILD_COUNT, PALETTES, buildIndex, hashOf, personaOf,
  type Palette, type Persona,
} from '../lib/agentBuilds';

export { BUILD_COUNT, PALETTES, buildIndex, hashOf, personaOf };
export type { Palette, Persona };

/**
 * The agent, as an actual object.
 *
 * The first version of this character was a flat SVG with a CSS tilt on it,
 * which gets you depth from across the room and nothing at all once somebody
 * tries to turn it. So it is built out of boxes here and rendered properly,
 * because "can I spin it" is the whole difference between a picture of a
 * robot and a robot.
 *
 * It is modelled rather than loaded. A downloaded model means a licence, a
 * pipeline, a few megabytes and a dependency on somebody else's server, to
 * get a thing made of a dozen boxes. A dozen boxes is a dozen boxes.
 *
 * Two groups deep on purpose. `root` carries whatever the person has dragged
 * it to and nothing else. `body` is where every pose writes, so a move can
 * spin, flip, lean and slide without fighting the hand holding it. Below
 * that, every limb hangs off its own pivot: shoulders and hips rotate where
 * a shoulder and a hip would, the head turns at the neck, and the face is
 * five mouth cubes and two brows that the expressions bend.
 *
 * The moods are deliberately unequal and the refusal is the biggest one, for
 * the reason written on the avatar component: a character more pleased to
 * have cleared a trade than to have stopped one is a character cheering the
 * agent on, and that is the one thing this product cannot have. Personality
 * changes how one of them looks while it holds the line. It never changes
 * which way the ranking runs.
 */

const MOUTH_CUBES = 5;

export interface Rig {
  root: THREE.Group;
  /** Everything a pose is allowed to move. Dragging moves `root` instead. */
  body: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  eyes: THREE.Group;
  brows: THREE.Mesh[];
  mouth: THREE.Mesh[];
  mouthY: number;
  browY: number;
  eyeMat: THREE.MeshStandardMaterial;
  chestMat: THREE.MeshStandardMaterial;
  faceMat: THREE.MeshStandardMaterial;
  antenna: THREE.Group | null;
  /** The buzz above the head when it is about to say something. */
  sparks: THREE.Mesh[];
  sparkMat: THREE.MeshStandardMaterial;
  /** Which antenna it has, which decides what shape the buzz takes. */
  antennaKind: number;
  dispose: () => void;
}

const box = (w: number, h: number, d: number, m: THREE.Material) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

export function buildAgent(index: number): Rig {
  const i = ((index % BUILD_COUNT) + BUILD_COUNT) % BUILD_COUNT;
  const p = PALETTES[i];
  const headShape = i % 3; // 0 square, 1 tall, 2 wide
  const antennaKind = i % 4; // 0 ball, 1 dish, 2 none, 3 two
  const eyeKind = i % 3; // 0 bars, 1 dots, 2 one visor slit

  const kept: (THREE.BufferGeometry | THREE.Material)[] = [];
  const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.52,
      metalness: 0.18,
      ...extra,
    });
    kept.push(m);
    return m;
  };

  const bodyMat = mat(p.body);
  const trimMat = mat(p.trim, { roughness: 0.66, metalness: 0.1 });
  const darkMat = mat('#11151a', { roughness: 0.34, metalness: 0.4 });
  const eyeMat = mat(p.accent, {
    emissive: new THREE.Color(p.accent),
    emissiveIntensity: 1.5,
    roughness: 0.28,
  });
  // The mouth and brows glow on the same circuit as the eyes but dimmer, so
  // a face reads as one lit panel rather than as three separate lamps.
  const faceMat = mat(p.accent, {
    emissive: new THREE.Color(p.accent),
    emissiveIntensity: 0.95,
    roughness: 0.3,
  });
  // The spark takes the build's own colour rather than white. A white cube
  // above a coloured robot reads as a missing texture; the same cube in the
  // colour its eyes already glow reads as the same circuit arcing.
  const sparkMat = mat(p.accent, {
    emissive: new THREE.Color(p.accent),
    emissiveIntensity: 3.2,
    roughness: 0.1,
  });
  const chestMat = mat(p.accent, {
    emissive: new THREE.Color(p.accent),
    emissiveIntensity: 0.55,
    roughness: 0.4,
  });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Legs on hip pivots, because a kick and a moonwalk both rotate at the hip
  // and neither works on a leg glued to the floor.
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.32, 0.56, 0);
    const leg = box(0.42, 0.5, 0.46, trimMat);
    leg.position.y = -0.25;
    hip.add(leg);
    const foot = box(0.56, 0.18, 0.7, darkMat);
    foot.position.set(0, -0.47, 0.07);
    hip.add(foot);
    body.add(hip);
    legs.push(hip);
  }

  const torso = box(1.36, 1.02, 0.86, bodyMat);
  torso.position.y = 1.06;
  body.add(torso);

  const chest = box(0.68, 0.42, 0.06, chestMat);
  chest.position.set(0, 1.1, 0.45);
  body.add(chest);

  const belt = box(1.4, 0.16, 0.9, trimMat);
  belt.position.y = 0.6;
  body.add(belt);

  // Arms on shoulder pivots, so a wave rotates at the shoulder rather than
  // sliding the whole arm sideways. Thick and held clear of the body: at the
  // first proportions they were slivers that vanished into the torso from
  // three quarters on, which takes the gesture with them.
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.9, 1.4, 0);
    const shoulder = box(0.34, 0.3, 0.34, trimMat);
    pivot.add(shoulder);
    const upper = box(0.3, 0.7, 0.3, bodyMat);
    upper.position.y = -0.46;
    pivot.add(upper);
    const hand = box(0.34, 0.26, 0.34, trimMat);
    hand.position.y = -0.92;
    pivot.add(hand);
    body.add(pivot);
    arms.push(pivot);
  }

  // Wide enough to read as a neck rather than as a gap between two blocks,
  // which is what a thin dark one looked like from any distance.
  const neck = box(0.58, 0.2, 0.5, trimMat);
  neck.position.y = 1.62;
  body.add(neck);

  // Two groups again. `head` sits down inside the neck, because that is
  // where a head actually pivots: with the pivot at the base of the skull,
  // tipping it back lifted the whole block off the shoulders and opened a
  // gap, worst on the tall head where the skull is deepest. `crown` carries
  // the skull back up to where it belongs.
  const head = new THREE.Group();
  head.position.y = 1.54;
  body.add(head);
  const crown = new THREE.Group();
  crown.position.y = 0.04;
  head.add(crown);

  const hw = headShape === 1 ? 1.1 : headShape === 2 ? 1.6 : 1.34;
  const hh = headShape === 1 ? 1.34 : headShape === 2 ? 0.94 : 1.12;
  const hd = 1.02;
  const skull = box(hw, hh, hd, bodyMat);
  skull.position.y = hh / 2;
  crown.add(skull);

  // The visor is the face, and everything expressive has to fit on it.
  // Sized off the head rather than off a constant, because the three head
  // shapes are different heights and a brow placed at a fixed offset ended
  // up on the forehead of the short one, where it read as a pair of horns.
  const visor = box(hw * 0.84, hh * 0.72, 0.08, darkMat);
  visor.position.set(0, hh * 0.5, hd / 2 + 0.02);
  crown.add(visor);

  const faceZ = hd / 2 + 0.08;
  const eyeY = hh * 0.6;
  const browY = hh * 0.6 + 0.16;
  const mouthY = hh * 0.3;

  const eyes = new THREE.Group();
  eyes.position.set(0, eyeY, faceZ);
  crown.add(eyes);
  if (eyeKind === 2) {
    for (const sx of [-1, 1]) {
      const e = box(hw * 0.2, 0.09, 0.04, eyeMat);
      e.position.x = sx * hw * 0.17;
      eyes.add(e);
    }
  } else {
    const ew = eyeKind === 0 ? 0.24 : 0.16;
    const eh = eyeKind === 0 ? 0.12 : 0.16;
    for (const sx of [-1, 1]) {
      const e = box(ew, eh, 0.04, eyeMat);
      e.position.x = sx * hw * 0.18;
      eyes.add(e);
    }
  }

  // Brows. Two blocks and an angle, and most of the expression is done: a
  // pair tilted inward is a scowl in any language, including this one.
  const brows: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const brow = box(hw * 0.26, 0.07, 0.04, faceMat);
    brow.position.set(sx * hw * 0.18, browY, faceZ);
    crown.add(brow);
    brows.push(brow);
  }

  // The mouth: five cubes on a curve. Lift the ends and it smiles, drop them
  // and it does not, raise every one of them and it is laughing. One shape
  // covers every expression this thing needs and it stays voxel while it
  // does it, where a drawn mouth would have looked pasted on.
  const mouth: THREE.Mesh[] = [];
  for (let c = 0; c < MOUTH_CUBES; c++) {
    const m = box(hw * 0.1, 0.07, 0.04, faceMat);
    m.position.set((c - (MOUTH_CUBES - 1) / 2) * hw * 0.115, mouthY, faceZ);
    crown.add(m);
    mouth.push(m);
  }

  for (const sx of [-1, 1]) {
    const ear = box(0.13, 0.36, 0.36, trimMat);
    ear.position.set(sx * (hw / 2 + 0.06), hh * 0.52, 0);
    crown.add(ear);
    const stud = box(0.05, 0.14, 0.14, chestMat);
    stud.position.set(sx * (hw / 2 + 0.13), hh * 0.52, 0);
    crown.add(stud);
  }

  let antenna: THREE.Group | null = null;
  if (antennaKind !== 2) {
    antenna = new THREE.Group();
    antenna.position.y = hh;
    crown.add(antenna);
    const stalks = antennaKind === 3 ? [-0.22, 0.22] : [0];
    for (const sx of stalks) {
      const rodGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8);
      kept.push(rodGeo);
      const rod = new THREE.Mesh(rodGeo, trimMat);
      rod.position.set(sx, 0.17, 0);
      antenna.add(rod);
      const tipGeo =
        antennaKind === 1
          ? new THREE.ConeGeometry(0.16, 0.14, 12)
          : new THREE.SphereGeometry(0.11, 14, 10);
      kept.push(tipGeo);
      const tip = new THREE.Mesh(tipGeo, chestMat);
      tip.position.set(sx, 0.4, 0);
      antenna.add(tip);
    }
  }

  // The buzz. Five cubes above the head that are invisible until the thing
  // is about to speak, arranged by which antenna it has: a crown for the
  // ball, a ring for the dish, an arc across the scalp for the ones with no
  // antenna at all, and a line between the two tips for the pair. Same five
  // cubes, four different shapes, no extra geometry.
  const sparks: THREE.Mesh[] = [];
  const SPARKS = 5;
  for (let c = 0; c < SPARKS; c++) {
    const sp = box(0.06, 0.06, 0.06, sparkMat);
    const u = c / (SPARKS - 1);
    if (antennaKind === 3) {
      sp.position.set(-0.22 + u * 0.44, hh + 0.42, 0);
    } else if (antennaKind === 1) {
      const a = u * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.26, hh + 0.46, Math.sin(a) * 0.26);
    } else if (antennaKind === 2) {
      sp.position.set((u - 0.5) * hw * 0.8, hh + 0.12, 0);
    } else {
      const a = u * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.2, hh + 0.42 + Math.sin(a) * 0.18, 0);
    }
    sp.visible = false;
    sp.castShadow = false;
    crown.add(sp);
    sparks.push(sp);
  }

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      kept.push((o as THREE.Mesh).geometry);
    }
  });

  // Stand it about its middle rather than on its feet, so turning it spins
  // it on the spot instead of swinging it around its ankles.
  root.position.y = -1.55;

  return {
    root,
    body,
    head,
    leftArm: arms[0],
    rightArm: arms[1],
    leftLeg: legs[0],
    rightLeg: legs[1],
    eyes,
    brows,
    mouth,
    mouthY,
    browY,
    eyeMat,
    chestMat,
    faceMat,
    antenna,
    sparks,
    sparkMat,
    antennaKind,
    dispose: () => {
      for (const k of kept) k.dispose();
    },
  };
}

export type Mood =
  | 'idle'
  | 'thinking'
  | 'cleared'
  | 'trimmed'
  | 'refused'
  | 'sealed'
  | 'greet';

const VERDICT_COLOUR: Partial<Record<Mood, string>> = {
  cleared: '#4ec2a5',
  trimmed: '#e0ac3c',
  refused: '#e8553e',
  sealed: '#4ec2a5',
};

/**
 * Put a face on.
 *
 * `curve` lifts the corners, `open` parts the lips, `brow` drives the inner
 * ends of the brows down. Everything else about an expression falls out of
 * those three.
 */
export function setFace(rig: Rig, brow: number, curve: number, open: number) {
  const n = rig.mouth.length;
  for (let c = 0; c < n; c++) {
    const u = (c - (n - 1) / 2) / ((n - 1) / 2); // -1 at the corners, 0 in the middle
    const m = rig.mouth[c];
    m.position.y = rig.mouthY + curve * u * u * 0.16 - open * 0.05;
    // An open mouth is tallest in the middle, which is what makes it read as
    // a mouth rather than as a thicker line.
    m.scale.y = 1 + open * 2.6 * (1 - 0.55 * u * u);
  }
  rig.brows[0].rotation.z = -brow;
  rig.brows[1].rotation.z = brow;
  // A scowl also drops the whole brow a little. Without that, an angry face
  // and a surprised one differ only by a tilt and read as the same face.
  for (const b of rig.brows) b.position.y = rig.browY - brow * 0.07;
}

/** The resting pose, used for the small stills as well as between gestures. */
export function restFace(rig: Rig, persona: Persona) {
  setFace(rig, persona.brow, persona.curve, persona.open);
}

/**
 * One frame of whatever the agent is doing.
 *
 * `t` is seconds since the mood started, `now` seconds since the scene did.
 * Everything is written against those two rather than against a tween
 * library, because these are a handful of short gestures and a library to
 * play them would be larger than all of them together.
 */
export interface Fx {
  /** About to speak. Zero to one, ramped by the caller. */
  charge: number;
  /** Speaking. Zero to one, so the hands move while there is a line up. */
  talk: number;
}

export function poseAgent(
  rig: Rig,
  mood: Mood,
  t: number,
  now: number,
  base: Palette,
  persona: Persona,
  fx: Fx = { charge: 0, talk: 0 },
) {
  const { body, head, leftArm, rightArm, leftLeg, rightLeg, eyes, eyeMat, chestMat, faceMat } = rig;

  // Idle, always underneath: a slow breath, a slow sway, and a blink every
  // few seconds at a time nobody can predict.
  const breathe = Math.sin(now * 1.15) * 0.035;
  body.position.set(0, breathe, 0);
  body.rotation.set(0, 0, 0);
  head.rotation.set(Math.sin(now * 0.8) * 0.03, Math.sin(now * 0.53) * 0.12, 0);
  leftArm.rotation.set(0, 0, Math.sin(now * 0.7) * 0.05 + 0.06);
  rightArm.rotation.set(0, 0, -Math.sin(now * 0.7) * 0.05 - 0.06);
  leftLeg.rotation.set(0, 0, 0);
  rightLeg.rotation.set(0, 0, 0);

  const blinkPhase = (now * 0.42) % 1;
  eyes.scale.y = blinkPhase > 0.965 ? 0.12 : 1;

  // What this one does while nothing is happening, which is nearly always,
  // and is therefore the motion most people will actually see. Turning
  // slowly on the spot was a placeholder: it says the renderer works and
  // nothing about who is standing there.
  ambient(rig, persona, now);

  // The face it wears when nothing is happening, which is most of the time
  // and is therefore the one that decides who this is.
  restFace(rig, persona);

  const tint = VERDICT_COLOUR[mood] ?? base.accent;
  eyeMat.color.set(tint);
  eyeMat.emissive.set(tint);
  eyeMat.emissiveIntensity = 1.5;
  faceMat.color.set(tint);
  faceMat.emissive.set(tint);
  faceMat.emissiveIntensity = 0.95;
  chestMat.emissiveIntensity = 0.55;

  buzz(rig, persona, now, fx.charge);

  if (mood === 'idle') {
    // Hands move while there is something being said. Layered over the
    // ambient rather than replacing it, so a talkative moment still looks
    // like the same character being talkative.
    talkGesture(rig, persona, now, fx.talk);
    return;
  }

  // Every gesture below rises, holds and falls, then the character is back
  // where it started. Written as a straight decay first, which meant each
  // one began at full extension on the frame it started and was already half
  // way home by the time anybody looked at it: a move that is only ever on
  // its way down does not read as a move.
  const env = (rise: number, hold: number, fall: number) => {
    if (t < rise) return t / rise;
    if (t < rise + hold) return 1;
    return Math.max(0, 1 - (t - rise - hold) / fall);
  };

  if (mood === 'thinking') {
    // Held, not decayed: it lasts as long as the gate takes.
    head.rotation.z = 0.16;
    head.rotation.y = 0.2 + Math.sin(now * 2.4) * 0.06;
    eyes.scale.y = 0.45;
    rightArm.rotation.x = -0.5 + Math.sin(now * 3.1) * 0.12;
    chestMat.emissiveIntensity = 0.55 + Math.abs(Math.sin(now * 3)) * 0.8;
    setFace(rig, persona.brow + 0.1, persona.curve * 0.4, 0);
    if (rig.antenna) rig.antenna.rotation.y = now * 3.4;
    return;
  }

  if (mood === 'greet') {
    signature(rig, persona, t, now, env);
    return;
  }

  if (mood === 'cleared') {
    // The smallest gesture in the set. A nod, and that is all.
    const k = env(0.1, 0.35, 0.5);
    head.rotation.x = Math.sin(t * 13) * 0.22 * k;
    eyeMat.emissiveIntensity = 1.5 + k * 1.2;
    setFace(rig, persona.brow, persona.curve + 0.12 * k, persona.open);
    return;
  }

  if (mood === 'trimmed') {
    // One hand out. Not stop, but not all of that either. Negative swings
    // the near arm away from the body; positive takes it across the chest,
    // which is a different gesture and not this one.
    const k = env(0.16, 0.6, 0.5);
    leftArm.rotation.z = -1.45 * k;
    leftArm.rotation.x = -0.35 * k;
    head.rotation.y = 0.22 * k;
    eyeMat.emissiveIntensity = 1.5 + k * 1.1;
    setFace(rig, persona.brow + 0.18 * k, persona.curve * (1 - k), persona.open * (1 - k));
    return;
  }

  if (mood === 'refused') {
    // The biggest thing it does, whoever it is. A recoil, a hard shake of
    // the head, both arms crossed, and the only moment any of these eight
    // faces is allowed to look the same: none of them like this.
    const k = env(0.13, 1.1, 0.55);
    const shake = Math.sin(t * 17) * k;
    head.rotation.y = shake * 0.5;
    head.rotation.x = -0.14 * k;
    body.position.z = -0.32 * k;
    body.position.y = breathe + 0.05 * k;
    leftArm.rotation.z = 1.15 * k;
    rightArm.rotation.z = -1.15 * k;
    leftArm.rotation.x = -0.75 * k;
    rightArm.rotation.x = -0.75 * k;
    eyes.scale.y = 1 - 0.45 * k;
    eyeMat.emissiveIntensity = 1.5 + k * 2.4;
    faceMat.emissiveIntensity = 0.95 + k * 1.8;
    chestMat.emissiveIntensity = 0.55 + k * 1.6;
    setFace(rig, persona.brow + 0.5 * k, persona.curve - (persona.curve + 0.5) * k, persona.open * (1 - k) + 0.18 * k);
    return;
  }

  if (mood === 'sealed') {
    const k = env(0.2, 0.9, 0.6);
    leftArm.rotation.z = -2.3 * k;
    rightArm.rotation.z = 2.3 * k;
    head.rotation.x = -0.18 * k;
    chestMat.emissiveIntensity = 0.55 + k * 1.4;
    setFace(rig, persona.brow, persona.curve + 0.14 * k, persona.open + 0.2 * k);
  }
}

/**
 * Standing there, being itself.
 *
 * A loop, in one place, at small amplitude, in the same register as the
 * signature move: whoever throws a kick when you pick them is tense while
 * they wait, and whoever moonwalks is loose. It never travels and it never
 * turns the body round, because this plays on a card the size of a stamp
 * next to a line of text, and a thing that wanders is a thing that has to
 * be chased.
 */
function ambient(rig: Rig, persona: Persona, now: number) {
  const { body, head, leftArm, rightArm, leftLeg, rightLeg, chestMat } = rig;

  switch (persona.move) {
    case 'ninja': {
      // Still, and watching. The only motion is a slow scan and hands held
      // ready, which is what quiet looks like when it is not asleep.
      head.rotation.y = Math.sin(now * 0.34) * 0.42;
      head.rotation.x = 0.04;
      leftArm.rotation.x = -0.22;
      rightArm.rotation.x = -0.22;
      leftArm.rotation.z = 0.2;
      rightArm.rotation.z = -0.2;
      body.position.y -= 0.03;
      break;
    }
    case 'bboy': {
      // On a beat, permanently.
      const beat = Math.sin(now * 3.4);
      body.position.y += Math.abs(beat) * 0.07;
      body.rotation.z = beat * 0.05;
      head.rotation.x = -Math.abs(beat) * 0.12;
      head.rotation.z = beat * 0.1;
      leftArm.rotation.z = 0.25 + beat * 0.34;
      rightArm.rotation.z = -0.25 + beat * 0.34;
      leftArm.rotation.x = -0.3 - beat * 0.2;
      rightArm.rotation.x = -0.3 + beat * 0.2;
      break;
    }
    case 'moonwalk': {
      // Weight from one foot to the other, unhurried.
      const sway = Math.sin(now * 0.9);
      body.rotation.z = sway * 0.055;
      body.position.y -= 0.02;
      head.rotation.z = -sway * 0.08;
      head.rotation.y = sway * 0.22;
      leftLeg.rotation.z = sway * 0.08;
      rightLeg.rotation.z = sway * 0.08;
      leftArm.rotation.z = 0.12 + sway * 0.1;
      rightArm.rotation.z = -0.12 + sway * 0.1;
      break;
    }
    case 'karate': {
      // Guard up, and never quite settled.
      const twitch = Math.sin(now * 5.5) * Math.max(0, Math.sin(now * 0.7));
      leftArm.rotation.x = -0.95;
      rightArm.rotation.x = -0.8;
      leftArm.rotation.z = 0.55;
      rightArm.rotation.z = -0.45;
      head.rotation.y = twitch * 0.2;
      head.rotation.x = 0.05;
      body.rotation.y = twitch * 0.06;
      body.position.y -= 0.05;
      break;
    }
    case 'laugh': {
      // Sets itself off every few seconds and cannot help it.
      const fit = Math.max(0, Math.sin(now * 0.55) - 0.55) / 0.45;
      const shake = Math.abs(Math.sin(now * 9)) * fit;
      body.position.y += shake * 0.08;
      head.rotation.x = -0.12 * fit - shake * 0.06;
      leftArm.rotation.x = -0.5 - shake * 0.3;
      rightArm.rotation.x = -0.5 - shake * 0.3;
      leftArm.rotation.z = 0.5;
      rightArm.rotation.z = -0.5;
      break;
    }
    case 'warrior': {
      // Arms crossed, feet planted, and almost nothing else. The point of
      // this one is that it does not move.
      leftArm.rotation.z = 1.18;
      rightArm.rotation.z = -1.18;
      leftArm.rotation.x = -0.82;
      rightArm.rotation.x = -0.82;
      leftLeg.rotation.z = 0.16;
      rightLeg.rotation.z = -0.16;
      head.rotation.y = Math.sin(now * 0.22) * 0.12;
      body.position.y -= 0.07;
      break;
    }
    case 'flex': {
      // One arm at a time, because it is never not doing this.
      const pump = Math.sin(now * 1.5);
      leftArm.rotation.z = -1.1 - Math.max(0, pump) * 1.2;
      rightArm.rotation.z = 1.1 + Math.max(0, -pump) * 1.2;
      leftArm.rotation.x = -0.3 - Math.max(0, pump) * 0.25;
      rightArm.rotation.x = -0.3 - Math.max(0, -pump) * 0.25;
      head.rotation.y = pump * 0.2;
      chestMat.emissiveIntensity = 0.55 + Math.abs(pump) * 0.4;
      break;
    }
    case 'flip': {
      // Cannot stand still. Shifts, glances, and every so often hops.
      const hop = Math.max(0, Math.sin(now * 0.8) - 0.82) / 0.18;
      body.position.y += hop * 0.22;
      leftLeg.rotation.x = -hop * 0.6;
      rightLeg.rotation.x = -hop * 0.6;
      head.rotation.y = Math.sin(now * 1.3) * 0.34;
      head.rotation.x = -0.05;
      leftArm.rotation.z = 0.2 + Math.sin(now * 2.1) * 0.15;
      rightArm.rotation.z = -0.2 - Math.sin(now * 2.1) * 0.15;
      break;
    }
  }
}

/**
 * Hands, while it is saying something.
 *
 * The bubble beside it changes every few seconds and the thing next to it
 * used to carry on breathing as though nothing were being said. This is
 * small on purpose: a couple of degrees at the shoulder on an offbeat
 * rhythm, and a mouth that opens on the syllables. Enough to connect the
 * two, not so much that it looks like semaphore.
 */
function talkGesture(rig: Rig, persona: Persona, now: number, amount: number) {
  if (amount <= 0.001) return;
  const a = Math.min(1, amount);
  const beat = Math.sin(now * 5.2);
  const off = Math.sin(now * 3.7 + 1.1);

  rig.leftArm.rotation.x += (-0.34 - beat * 0.16) * a;
  rig.rightArm.rotation.x += (-0.28 - off * 0.16) * a;
  rig.leftArm.rotation.z += 0.22 * a;
  rig.rightArm.rotation.z += -0.18 * a;
  rig.head.rotation.x += beat * 0.035 * a;
  rig.head.rotation.y += off * 0.07 * a;

  // The mouth works while the words are on screen. Held above the resting
  // curve rather than replacing it, so a furious one still talks furiously.
  const syl = Math.abs(Math.sin(now * 7.4)) * Math.abs(Math.sin(now * 2.3));
  setFace(rig, persona.brow, persona.curve, Math.min(1, persona.open + syl * 0.7 * a));
}

/**
 * The buzz before it speaks.
 *
 * A line that simply swaps for another line is a text field. A tell a
 * second beforehand, above the head, makes it something the thing did.
 * Which shape the buzz takes comes off the antenna it was built with, so
 * the four kinds are four different tells rather than one effect recoloured.
 */
function buzz(rig: Rig, persona: Persona, now: number, charge: number) {
  const on = charge > 0.01;
  if (!on) {
    for (const sp of rig.sparks) sp.visible = false;
    if (rig.antenna) rig.antenna.rotation.y = 0;
    return;
  }

  const c = Math.min(1, charge);
  const n = rig.sparks.length;
  for (let i = 0; i < n; i++) {
    const sp = rig.sparks[i];
    // Each cube on its own fast cycle, so the set crackles rather than
    // pulsing in unison like a row of indicator lamps.
    const phase = Math.sin(now * (26 + i * 5.5) + i * 2.1);
    const alive = phase > 0.35 - c * 0.9;
    sp.visible = alive;
    const size = (0.55 + 0.75 * Math.abs(phase)) * c;
    sp.scale.setScalar(size);
  }

  rig.sparkMat.emissiveIntensity = 2.4 + c * 3.4;
  rig.chestMat.emissiveIntensity = 0.55 + c * 1.1;
  if (rig.antenna) {
    rig.antenna.rotation.y = now * (rig.antennaKind === 1 ? 5.5 : 3.2) * c;
    rig.antenna.rotation.z = Math.sin(now * 19) * 0.07 * c;
  }
  rig.head.rotation.z += Math.sin(now * 21) * 0.012 * c;
}

/**
 * The move that belongs to this one and to nobody else.
 *
 * Eight robots that all wave are one robot in eight colours. These are the
 * two seconds where each of them says which one it is, and no two of them
 * use the same limbs to do it.
 */
function signature(
  rig: Rig,
  persona: Persona,
  t: number,
  now: number,
  env: (r: number, h: number, f: number) => number,
) {
  const { body, head, leftArm, rightArm, leftLeg, rightLeg, eyes, chestMat } = rig;
  const k = env(0.24, 2.0, 0.7);

  switch (persona.move) {
    case 'ninja': {
      // A bow, then a chop, and a low stance held through the middle of it.
      const bow = Math.min(1, t / 0.45) * (t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) / 0.3));
      body.rotation.x = 0.42 * bow * k;
      const chop = t > 1.0 ? Math.max(0, 1 - (t - 1.0) / 0.45) : 0;
      rightArm.rotation.x = -2.0 * chop;
      rightArm.rotation.z = -0.25 * k;
      leftArm.rotation.z = 0.9 * k;
      leftArm.rotation.x = -0.4 * k;
      leftLeg.rotation.x = 0.3 * k;
      rightLeg.rotation.x = -0.34 * k;
      body.position.y -= 0.16 * k;
      if (chop > 0.4) eyes.scale.y = 0.3;
      break;
    }

    case 'bboy': {
      // Spin on the spot, drop into a tilt, plant one arm and freeze on it.
      const spinning = t < 1.5;
      body.rotation.y = spinning ? t * 9 : 13.5;
      body.rotation.z = (spinning ? 0.2 : 0.62) * k;
      body.position.y -= (spinning ? 0.1 : 0.34) * k;
      leftArm.rotation.z = (spinning ? -1.9 : -2.5) * k;
      rightArm.rotation.z = (spinning ? 2.2 : 0.4) * k;
      rightArm.rotation.x = spinning ? 0 : -0.8 * k;
      leftLeg.rotation.z = -0.5 * k;
      rightLeg.rotation.x = -0.9 * k;
      head.rotation.z = -0.3 * k;
      chestMat.emissiveIntensity = 0.55 + Math.abs(Math.sin(t * 8)) * 0.9;
      break;
    }

    case 'moonwalk': {
      // Slide backwards while the legs insist on going forwards.
      const glide = Math.sin(t * 1.9);
      body.position.x = -0.55 * glide * k;
      body.rotation.y = -0.5 * k;
      const step = Math.sin(t * 7.5);
      leftLeg.rotation.x = 0.55 * step * k;
      rightLeg.rotation.x = -0.55 * step * k;
      leftArm.rotation.x = -0.45 * step * k;
      rightArm.rotation.x = 0.45 * step * k;
      leftArm.rotation.z = 0.35 * k;
      rightArm.rotation.z = -0.35 * k;
      head.rotation.y = 0.5 * k;
      head.rotation.z = -0.1 * k;
      break;
    }

    case 'karate': {
      // A shout, a guard, and a leg that comes all the way up.
      const wind = Math.min(1, t / 0.3);
      const kick = t > 0.4 ? Math.max(0, 1 - Math.abs(t - 0.85) / 0.5) : 0;
      rightLeg.rotation.x = -1.9 * kick;
      leftLeg.rotation.x = 0.22 * k;
      body.rotation.x = -0.24 * kick;
      body.rotation.y = 0.5 * k;
      body.position.y += 0.14 * kick;
      rightArm.rotation.x = -1.5 * kick;
      rightArm.rotation.z = -0.5 * k;
      leftArm.rotation.z = 1.0 * wind * k;
      leftArm.rotation.x = -1.0 * wind * k;
      head.rotation.y = -0.34 * k;
      setFace(rig, persona.brow + 0.25, persona.curve - 0.2, persona.open + 0.4 * kick);
      break;
    }

    case 'laugh': {
      // Head back, hands on the belly, and unable to stand still.
      const bounce = Math.abs(Math.sin(t * 8));
      body.position.y += 0.13 * bounce * k;
      body.rotation.x = -0.12 * k;
      head.rotation.x = -0.2 * k - 0.05 * bounce;
      leftArm.rotation.x = -1.25 * k;
      rightArm.rotation.x = -1.25 * k;
      leftArm.rotation.z = 0.78 * k;
      rightArm.rotation.z = -0.78 * k;
      leftLeg.rotation.x = 0.16 * bounce * k;
      rightLeg.rotation.x = -0.16 * bounce * k;
      eyes.scale.y = 0.22;
      setFace(rig, persona.brow, persona.curve + 0.2, 1);
      break;
    }

    case 'warrior': {
      // Plant, cross, thump, and then refuse to be anywhere else.
      const drop = t < 0.3 ? t / 0.3 : 1;
      const thump = t > 0.3 && t < 0.5 ? 1 - (t - 0.3) / 0.2 : 0;
      body.position.y -= (0.2 * drop + 0.1 * thump) * k;
      body.rotation.y = Math.sin(t * 0.9) * 0.3 * k;
      leftLeg.rotation.z = 0.3 * k;
      rightLeg.rotation.z = -0.3 * k;
      leftArm.rotation.z = 1.2 * k;
      rightArm.rotation.z = -1.2 * k;
      leftArm.rotation.x = -0.85 * k;
      rightArm.rotation.x = -0.85 * k;
      head.rotation.x = -0.1 * k;
      break;
    }

    case 'flex': {
      // Both arms up and in, and a slow turn to make sure you saw.
      leftArm.rotation.z = -2.5 * k;
      rightArm.rotation.z = 2.5 * k;
      leftArm.rotation.x = -0.5 * k;
      rightArm.rotation.x = -0.5 * k;
      body.rotation.y = Math.sin(t * 1.6) * 0.42 * k;
      body.position.y -= 0.08 * k;
      leftLeg.rotation.z = 0.2 * k;
      rightLeg.rotation.z = -0.2 * k;
      head.rotation.y = Math.sin(t * 1.6 + 0.6) * 0.3 * k;
      chestMat.emissiveIntensity = 0.55 + Math.abs(Math.sin(t * 2.2)) * 1.1;
      break;
    }

    case 'flip': {
      // Up, over, and down, once, and land on the beat.
      const span = 1.25;
      const u = Math.min(1, t / span);
      const air = Math.sin(Math.PI * u);
      // Low enough to stay in frame. At the first height the whole robot
      // left the top of the canvas and came back, which is a jump nobody
      // sees the middle of.
      body.position.y += 0.62 * air;
      const turn = -Math.PI * 2 * u;
      body.rotation.x = turn;
      // A group rotates about its own origin, which here is the floor under
      // its feet, so a full turn threw the head out on the end of a metre
      // long arm and off the canvas. Rotating about the waist means adding
      // back whatever the rotation moved the waist by.
      const waist = 1.0;
      body.position.y += waist - waist * Math.cos(turn);
      body.position.z -= waist * Math.sin(turn);
      const tuck = air;
      leftLeg.rotation.x = -1.5 * tuck;
      rightLeg.rotation.x = -1.5 * tuck;
      leftArm.rotation.z = -1.3 * tuck;
      rightArm.rotation.z = 1.3 * tuck;
      if (t > span) {
        // The landing: a dip, and then back up.
        const l = Math.max(0, 1 - (t - span) / 0.35);
        body.position.y -= 0.24 * l;
        leftLeg.rotation.x = 0.3 * l;
        rightLeg.rotation.x = 0.3 * l;
      }
      break;
    }
  }
}

/** The lights and the ground, shared by the stage and the small portraits. */
export function dressScene(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x15181d, 1.15));

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(3.2, 5.4, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.0012;
  scene.add(key);

  // A cold rim from behind, which is most of why a matte box reads as a
  // solid object rather than as a flat shape.
  const rim = new THREE.DirectionalLight(0x7fd8ff, 1.5);
  rim.position.set(-4, 2.4, -3.6);
  scene.add(rim);

  const fill = new THREE.DirectionalLight(0xffb279, 0.55);
  fill.position.set(-2.4, -1.6, 3);
  scene.add(fill);
}
