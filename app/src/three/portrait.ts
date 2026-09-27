import { isLite } from '../lib/lite';
import { norm, saveStills, stills } from '../lib/portraitStore';
import * as THREE from 'three';
import { buildAgent, dressScene, restFace, personaOf, BUILD_COUNT } from './agentMesh';

/**
 * A still of the same robot, small.
 *
 * The header and the band above the log want a face at twenty six and
 * thirty eight pixels. A live WebGL canvas for each of those, on a phone,
 * to draw something the size of a fingernail, is absurd; drawing a
 * different character there instead is worse, because then the product has
 * two agents again.
 *
 * So the robot is rendered once per build to a small transparent image and
 * that image is what the little ones show. One context, eight pictures,
 * cached for the life of the tab. Same object, same colours, same identity,
 * at a cost of nothing per frame.
 */

let renderer: THREE.WebGLRenderer | null = null;

const SIZE = 192;

// Kept on the device through lib/portraitStore, so a phone draws each robot
// once ever rather than once per launch. Profiling a Galaxy A13 class
// device, opening the Chart tab spent 3.7 of 6.7 seconds compiling shaders
// and encoding these. Bump the version in portraitStore when the look changes.
const cache = stills;

export function knownPortrait(index: number): string | null {
  return cache.get(norm(index)) ?? null;
}

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer) return renderer;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !isLite() });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearAlpha(0);
    return renderer;
  } catch {
    // No WebGL. The caller falls back to a drawn mark rather than a hole.
    return null;
  }
}

export function portraitOf(index: number): string | null {
  const i = ((index % BUILD_COUNT) + BUILD_COUNT) % BUILD_COUNT;
  const hit = cache.get(i);
  if (hit) return hit;

  const r = getRenderer();
  if (!r) return null;

  const scene = new THREE.Scene();
  dressScene(scene);
  const rig = buildAgent(i);
  // The still wears the same resting face the live one does, so the small
  // avatar in the header is recognisably the same character and not a
  // blank version of it.
  restFace(rig, personaOf(i));
  // Head and shoulders, turned a few degrees off square so it reads as an
  // object rather than as a mugshot.
  rig.root.rotation.y = 0.42;
  rig.root.position.y = -2.62;
  scene.add(rig.root);

  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 40);
  cam.position.set(0, 0.3, 5.6);
  cam.lookAt(0, 0.05, 0);

  let url: string | null = null;
  try {
    r.render(scene, cam);
    // WebP encodes several times faster than PNG and comes out smaller,
    // with the same transparency.
    url = r.domElement.toDataURL('image/webp', 0.9);
    if (!url.startsWith('data:image/webp')) url = r.domElement.toDataURL('image/png');
  } catch {
    url = null;
  }

  scene.remove(rig.root);
  rig.dispose();

  if (url) { cache.set(i, url); saveStills(); }
  return url;
}
