import React, { useEffect, useRef } from 'react';
import type { Mood } from '../three/agentMesh';

/**
 * The agent on screen, turnable.
 *
 * Three is loaded on demand rather than bundled into the first paint,
 * because the only screens that want a live robot are the vault and the
 * picker, and somebody who opens the log and closes it again should not
 * have paid for a renderer.
 *
 * Every failure path here ends in nothing rather than in a broken box. A
 * browser with no WebGL, a context lost on a phone that went to sleep, a
 * machine that cannot allocate: the canvas stays empty and whatever is
 * behind it shows through. Nothing about the product depends on this thing
 * drawing, which is the correct amount of weight to put on a mascot.
 */
export const AgentModel: React.FC<{
  /** The key it belongs to, which decides which of the eight it is. */
  seed: string;
  variant: number;
  mood?: Mood;
  size: number;
  /** Turn slowly by itself until somebody grabs it. */
  autoSpin?: boolean;
  /** Let the pointer turn it. Off for the small ones in a list. */
  interactive?: boolean;
  className?: string;
}> = ({ seed, variant, mood = 'idle', size, autoSpin = false, interactive = true, className = '' }) => {
  const host = useRef<HTMLDivElement>(null);
  // The loop reads these rather than closing over them, so a mood change
  // does not tear down and rebuild the scene.
  const live = useRef({ mood, autoSpin, moodAt: 0 });

  useEffect(() => {
    if (live.current.mood !== mood) live.current.moodAt = performance.now() / 1000;
    live.current.mood = mood;
    live.current.autoSpin = autoSpin;
  }, [mood, autoSpin]);

  useEffect(() => {
    let stop = false;
    let teardown: (() => void) | undefined;

    (async () => {
      const el = host.current;
      if (!el) return;

      let THREE: typeof import('three');
      let mesh: typeof import('../three/agentMesh');
      try {
        [THREE, mesh] = await Promise.all([
          import('three'),
          import('../three/agentMesh'),
        ]);
      } catch {
        return; // no renderer, no mascot, no error on screen
      }
      if (stop) return;

      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      } catch {
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(size, size, false);
      renderer.setClearAlpha(0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.style.width = `${size}px`;
      renderer.domElement.style.height = `${size}px`;
      renderer.domElement.style.touchAction = interactive ? 'none' : 'auto';
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      mesh.dressScene(scene);

      const index = mesh.buildIndex(seed, variant);
      const rig = mesh.buildAgent(index);
      const palette = mesh.PALETTES[index];
      scene.add(rig.root);

      // A plane that catches the shadow and is otherwise invisible, so the
      // robot stands on something without a floor being drawn.
      const floorGeo = new THREE.PlaneGeometry(9, 9);
      const floorMat = new THREE.ShadowMaterial({ opacity: 0.42 });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.58;
      floor.receiveShadow = true;
      scene.add(floor);

      // Framed so it fills the box. At the first distance it sat in the
      // middle of a lot of nothing, which reads as a small robot rather
      // than as a close one.
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
      cam.position.set(0, 0.16, 7.05);
      cam.lookAt(0, -0.04, 0);

      // Turning it. Kept as a target the rendered angle chases, so letting
      // go coasts instead of stopping dead.
      let yaw = 0.5;
      let pitch = 0.05;
      let yawTo = yaw;
      let pitchTo = pitch;
      let spun = 0; // how much the pointer has moved it, for the auto spin
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let touchedAt = 0;

      const onDown = (e: PointerEvent) => {
        if (!interactive) return;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        touchedAt = performance.now();
        renderer.domElement.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        yawTo += (e.clientX - lastX) * 0.011;
        pitchTo += (e.clientY - lastY) * 0.007;
        pitchTo = Math.max(-0.5, Math.min(0.6, pitchTo));
        lastX = e.clientX;
        lastY = e.clientY;
        spun += Math.abs(e.clientX - lastX);
        touchedAt = performance.now();
      };
      const onUp = (e: PointerEvent) => {
        dragging = false;
        try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      };
      if (interactive) {
        renderer.domElement.addEventListener('pointerdown', onDown);
        renderer.domElement.addEventListener('pointermove', onMove);
        renderer.domElement.addEventListener('pointerup', onUp);
        renderer.domElement.addEventListener('pointercancel', onUp);
      }

      const slow = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

      let raf = 0;
      const t0 = performance.now() / 1000;
      live.current.moodAt = t0;

      const frame = () => {
        if (stop) return;
        raf = requestAnimationFrame(frame);
        const now = performance.now() / 1000;

        // Turn by itself only while nobody is holding it, and only after a
        // few seconds of being left alone, so it never fights a drag.
        const idleFor = (performance.now() - touchedAt) / 1000;
        if (live.current.autoSpin && !dragging && (touchedAt === 0 || idleFor > 2.5) && !slow) {
          yawTo += 0.0055;
        }

        yaw += (yawTo - yaw) * 0.12;
        pitch += (pitchTo - pitch) * 0.12;

        const t = slow ? 0 : now - live.current.moodAt;
        mesh.poseAgent(rig, live.current.mood, t, slow ? 0 : now, palette);
        rig.root.rotation.y = yaw;
        rig.root.rotation.x = pitch;

        renderer.render(scene, cam);
      };
      frame();

      teardown = () => {
        cancelAnimationFrame(raf);
        if (interactive) {
          renderer.domElement.removeEventListener('pointerdown', onDown);
          renderer.domElement.removeEventListener('pointermove', onMove);
          renderer.domElement.removeEventListener('pointerup', onUp);
          renderer.domElement.removeEventListener('pointercancel', onUp);
        }
        rig.dispose();
        floorGeo.dispose();
        floorMat.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      stop = true;
      teardown?.();
    };
  }, [seed, variant, size, interactive]);

  return (
    <div
      ref={host}
      className={`agent-model ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
};
