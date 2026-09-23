import * as THREE from 'three';
import { BUILD_COUNT, PALETTES, buildIndex, hashOf, type Palette } from '../lib/agentBuilds';

export { BUILD_COUNT, PALETTES, buildIndex, hashOf };

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
 * get a thing made of nine boxes. Nine boxes is nine boxes.
 *
 * Every part hangs off a named pivot so the moods can move it: shoulders
 * rotate at the shoulder, the head at the neck, and the eyes scale to zero
 * to blink. The moods are deliberately unequal and the refusal is the
 * biggest one, for the reason written on the avatar component: a character
 * more pleased to have cleared a trade than to have stopped one is a
 * character cheering the agent on, and that is the one thing this product
 * cannot have.
 */

export type { Palette };

export interface Rig {
  root: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  eyes: THREE.Group;
  eyeMat: THREE.MeshStandardMaterial;
  chestMat: THREE.MeshStandardMaterial;
  antenna: THREE.Group | null;
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
  const chestMat = mat(p.accent, {
    emissive: new THREE.Color(p.accent),
    emissiveIntensity: 0.55,
    roughness: 0.4,
  });

  const root = new THREE.Group();

  // Legs, stubby, because the thing has to stand and nothing else.
  for (const sx of [-1, 1]) {
    const leg = box(0.42, 0.5, 0.46, trimMat);
    leg.position.set(sx * 0.32, 0.3, 0);
    root.add(leg);
    const foot = box(0.56, 0.18, 0.7, darkMat);
    foot.position.set(sx * 0.32, 0.09, 0.07);
    root.add(foot);
  }

  const torso = box(1.36, 1.02, 0.86, bodyMat);
  torso.position.y = 1.06;
  root.add(torso);

  const chest = box(0.68, 0.42, 0.06, chestMat);
  chest.position.set(0, 1.1, 0.45);
  root.add(chest);

  const belt = box(1.4, 0.16, 0.9, trimMat);
  belt.position.y = 0.6;
  root.add(belt);

  // Arms on shoulder pivots, so a wave rotates at the shoulder rather than
  // sliding the whole arm sideways. Thick and held clear of the body: at
  // the first proportions they were slivers that vanished into the torso
  // from three quarters on, which takes the wave with them.
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
    root.add(pivot);
    arms.push(pivot);
  }

  // Wide enough to read as a neck rather than as a gap between two blocks,
  // which is what a thin dark one looked like from any distance.
  const neck = box(0.58, 0.2, 0.5, trimMat);
  neck.position.y = 1.62;
  root.add(neck);

  // Head on its own pivot at the neck, so a tilt reads as a tilt.
  const head = new THREE.Group();
  head.position.y = 1.68;
  root.add(head);

  const hw = headShape === 1 ? 1.1 : headShape === 2 ? 1.6 : 1.34;
  const hh = headShape === 1 ? 1.34 : headShape === 2 ? 0.94 : 1.12;
  const hd = 1.02;
  const skull = box(hw, hh, hd, bodyMat);
  skull.position.y = hh / 2;
  head.add(skull);

  // The visor is the face. Everything expressive sits on it.
  const visor = box(hw * 0.8, hh * 0.5, 0.08, darkMat);
  visor.position.set(0, hh * 0.56, hd / 2 + 0.02);
  head.add(visor);

  const eyes = new THREE.Group();
  eyes.position.set(0, hh * 0.56, hd / 2 + 0.08);
  head.add(eyes);
  if (eyeKind === 2) {
    const slit = box(hw * 0.56, 0.1, 0.04, eyeMat);
    eyes.add(slit);
  } else {
    const ew = eyeKind === 0 ? 0.26 : 0.17;
    const eh = eyeKind === 0 ? 0.13 : 0.17;
    for (const sx of [-1, 1]) {
      const e = box(ew, eh, 0.04, eyeMat);
      e.position.x = sx * hw * 0.19;
      eyes.add(e);
    }
  }

  // Ear blocks, which do nothing except make the head read as a head.
  for (const sx of [-1, 1]) {
    const ear = box(0.13, 0.36, 0.36, trimMat);
    ear.position.set(sx * (hw / 2 + 0.06), hh * 0.52, 0);
    head.add(ear);
    const stud = box(0.05, 0.14, 0.14, chestMat);
    stud.position.set(sx * (hw / 2 + 0.13), hh * 0.52, 0);
    head.add(stud);
  }

  let antenna: THREE.Group | null = null;
  if (antennaKind !== 2) {
    antenna = new THREE.Group();
    antenna.position.y = hh;
    head.add(antenna);
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

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      kept.push((o as THREE.Mesh).geometry);
    }
  });

  // Stand it on the origin rather than on its feet, so rotating it spins it
  // about its middle instead of swinging it around its ankles.
  root.position.y = -1.55;

  return {
    root,
    head,
    leftArm: arms[0],
    rightArm: arms[1],
    eyes,
    eyeMat,
    chestMat,
    antenna,
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
 * One frame of whatever the agent is doing.
 *
 * `t` is seconds since the mood started, `now` seconds since the scene did.
 * Everything is written against those two rather than against a tween
 * library, because these are six short gestures and a library to play them
 * would be larger than all six.
 */
export function poseAgent(rig: Rig, mood: Mood, t: number, now: number, base: Palette) {
  const { head, leftArm, rightArm, eyes, eyeMat, chestMat } = rig;

  // Idle, always underneath: a slow breath, a slow sway, and a blink every
  // few seconds at a time nobody can predict.
  const breathe = Math.sin(now * 1.15) * 0.035;
  rig.root.position.y = -1.55 + breathe;
  head.rotation.set(Math.sin(now * 0.8) * 0.03, Math.sin(now * 0.53) * 0.12, 0);
  leftArm.rotation.set(0, 0, Math.sin(now * 0.7) * 0.05 + 0.06);
  rightArm.rotation.set(0, 0, -Math.sin(now * 0.7) * 0.05 - 0.06);

  const blinkPhase = (now * 0.42) % 1;
  const blinking = blinkPhase > 0.965;
  eyes.scale.y = blinking ? 0.12 : 1;

  const tint = VERDICT_COLOUR[mood] ?? base.accent;
  eyeMat.color.set(tint);
  eyeMat.emissive.set(tint);
  eyeMat.emissiveIntensity = 1.5;
  chestMat.emissiveIntensity = 0.55;

  if (mood === 'idle') return;

  // Every gesture below rises, holds and falls, then the character is back
  // where it started. Written as a straight decay first, which meant each
  // one began at full extension on the frame it started and was already
  // half way home by the time anybody looked at it: a wave that is only
  // ever on its way down does not read as a wave.
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
    if (rig.antenna) rig.antenna.rotation.y = now * 3.4;
    return;
  }

  if (mood === 'greet') {
    const k = env(0.28, 2.1, 0.7);
    // A wave, and a wink at the top of it. The near arm does it: the model
    // rests turned a few degrees, so waving with the far one puts the whole
    // gesture behind the torso where nobody sees it.
    // Negative swings the near arm away from the body. Positive takes it
    // across the chest, which is a different gesture entirely and not a
    // friendly one.
    leftArm.rotation.z = -2.55 * k;
    leftArm.rotation.x = Math.sin(t * 9) * 0.5 * k;
    head.rotation.z = 0.1 * k;
    head.rotation.y = -0.18 * k;
    if (t > 0.5 && t < 0.78) eyes.scale.y = 0.12;
    chestMat.emissiveIntensity = 0.55 + k * 0.7;
    return;
  }

  if (mood === 'cleared') {
    // The smallest gesture in the set. A nod, and that is all.
    const k = env(0.1, 0.35, 0.5);
    head.rotation.x = Math.sin(t * 13) * 0.22 * k;
    eyeMat.emissiveIntensity = 1.5 + k * 1.2;
    return;
  }

  if (mood === 'trimmed') {
    // One hand out. Not stop, but not all of that either. Near arm, for
    // the same reason the wave uses it.
    const k = env(0.16, 0.6, 0.5);
    leftArm.rotation.z = -1.45 * k;
    leftArm.rotation.x = -0.35 * k;
    head.rotation.y = 0.22 * k;
    eyeMat.emissiveIntensity = 1.5 + k * 1.1;
    return;
  }

  if (mood === 'refused') {
    // The biggest thing it does. A recoil, a hard shake of the head, and
    // both arms crossed on the way back.
    const k = env(0.13, 1.1, 0.55);
    const shake = Math.sin(t * 17) * k;
    head.rotation.y = shake * 0.5;
    head.rotation.x = -0.14 * k;
    rig.root.position.z = -0.32 * k;
    rig.root.position.y = -1.55 + breathe + 0.05 * k;
    leftArm.rotation.z = 1.15 * k;
    rightArm.rotation.z = -1.15 * k;
    leftArm.rotation.x = -0.75 * k;
    rightArm.rotation.x = -0.75 * k;
    eyes.scale.y = 1 - 0.45 * k;
    eyeMat.emissiveIntensity = 1.5 + k * 2.4;
    chestMat.emissiveIntensity = 0.55 + k * 1.6;
    return;
  }

  if (mood === 'sealed') {
    const k = env(0.2, 0.9, 0.6);
    leftArm.rotation.z = -2.3 * k;
    rightArm.rotation.z = 2.3 * k;
    head.rotation.x = -0.18 * k;
    chestMat.emissiveIntensity = 0.55 + k * 1.4;
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
