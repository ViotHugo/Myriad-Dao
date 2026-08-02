// The camera rig.
//
// The composition is authored: there is no free-fly. The player may nudge the
// view inside a small arc, and everything else — where we look, from how far,
// and how we get from one framing to the next — is the game's decision.

import * as THREE from 'three';

/** Named framings. Opening the Sect tab moves the camera; it does not hide the world. */
export const FRAMINGS = {
  world:  { target: [0.8, 2.6, -1.0], dist: 12.5, yaw: 0.62, pitch: 0.17, fov: 42, drift: 1 },
  close:  { target: [0.0, 1.3, 0.0],  dist: 5.6,  yaw: 0.45, pitch: 0.10, fov: 40, drift: 0.6 },
  // The sheet covers the lower ~68% of a phone screen, so the sect framing aims
  // well below the valley: that lifts the sect into the strip the player can
  // actually still see. Otherwise "the camera moves to the sect" is a lie.
  sect:   { target: [2.0, -26.0, -52.0], dist: 46, yaw: 0.95, pitch: 0.30, fov: 44, drift: 0.7 },
  trib:   { target: [0.0, 2.2, 0.0],  dist: 14.0, yaw: 0.30, pitch: 0.02, fov: 50, drift: 0.3 },
  forge:  { target: [5.2, 1.1, 3.4],  dist: 4.6,  yaw: 0.90, pitch: 0.14, fov: 40, drift: 0.4 },
  duel:   { target: [26, -3.2, -14],  dist: 13.5, yaw: 0.10, pitch: 0.08, fov: 46, drift: 0.3 },
  rebirth: { target: [0.0, 3.0, 0.0], dist: 20.0, yaw: 0.62, pitch: -0.02, fov: 55, drift: 0.2 },
};

export function createCameraRig(camera, canvas, { onTap, onDoubleTap, reducedMotion = () => false }) {
  const cur = {
    target: new THREE.Vector3(...FRAMINGS.world.target),
    dist: FRAMINGS.world.dist,
    yaw: FRAMINGS.world.yaw,
    pitch: FRAMINGS.world.pitch,
    fov: FRAMINGS.world.fov,
    drift: 1,
  };
  const goal = { ...FRAMINGS.world, target: new THREE.Vector3(...FRAMINGS.world.target) };

  // Player nudges, layered on top of whatever the game has framed.
  const user = { yaw: 0, pitch: 0, zoom: 1 };
  const YAW_ARC = 0.62;
  const PITCH_ARC = { min: -0.16, max: 0.40 };
  const ZOOM = { min: 0.62, max: 1.45 };

  let framing = 'world';
  let blend = 1; // 1 = settled

  function setFraming(name, instant = false) {
    const f = FRAMINGS[name] || FRAMINGS.world;
    framing = name;
    goal.target.set(...f.target);
    goal.dist = f.dist;
    goal.yaw = f.yaw;
    goal.pitch = f.pitch;
    goal.fov = f.fov;
    goal.drift = f.drift;
    blend = instant ? 1 : 0;
    if (instant) {
      cur.target.copy(goal.target);
      cur.dist = goal.dist; cur.yaw = goal.yaw; cur.pitch = goal.pitch; cur.fov = goal.fov;
      cur.drift = goal.drift;
    }
  }

  /* -------------------------------------------------------------- input */

  const pointers = new Map();
  let downAt = 0;
  let downPos = { x: 0, y: 0 };
  let moved = 0;
  let pinchStart = 0;
  let pinchZoom = 1;
  let lastTapTime = 0;

  function pointerDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e) {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downAt = performance.now();
      downPos = { x: e.clientX, y: e.clientY };
      moved = 0;
    } else if (pointers.size === 2) {
      pinchStart = pointerDistance();
      pinchZoom = user.zoom;
    }
  }

  function onPointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pointers.size === 2) {
      const d = pointerDistance();
      if (pinchStart > 0) {
        user.zoom = THREE.MathUtils.clamp(pinchZoom * (pinchStart / d), ZOOM.min, ZOOM.max);
      }
      return;
    }
    moved += Math.hypot(dx, dy);
    if (moved > 8) {
      user.yaw = THREE.MathUtils.clamp(user.yaw - dx * 0.0042, -YAW_ARC, YAW_ARC);
      user.pitch = THREE.MathUtils.clamp(user.pitch + dy * 0.0032, PITCH_ARC.min, PITCH_ARC.max);
    }
  }

  function onPointerUp(e) {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (!wasSingle) return;

    const dt = performance.now() - downAt;
    if (dt < 260 && moved < 12) {
      const now = performance.now();
      // A tap always cultivates — this is an idle game and the canvas is the
      // button, so a double-tap must never swallow one. Re-framing rides along
      // on top, and only when there is a nudged camera to undo.
      onTap?.(e);
      const quick = now - lastTapTime < 320;
      lastTapTime = quick ? 0 : now;
      if (quick && hasUserOffset()) {
        user.yaw = 0; user.pitch = 0; user.zoom = 1;
        onDoubleTap?.();
      }
    }
  }

  function hasUserOffset() {
    return Math.abs(user.yaw) > 0.01 || Math.abs(user.pitch) > 0.01 || Math.abs(user.zoom - 1) > 0.01;
  }

  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerup', onPointerUp, { passive: true });
  canvas.addEventListener('pointercancel', onPointerUp, { passive: true });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ------------------------------------------------------------- update */

  let driftT = 0;

  function update(dt) {
    // Ease toward the framing. A hard cut between framings reads as a bug.
    blend = Math.min(1, blend + dt * 0.9);
    const k = 1 - Math.pow(1 - blend, 3);
    const rate = Math.min(1, dt * (2.2 + k * 3));
    cur.target.lerp(goal.target, rate);
    cur.dist += (goal.dist - cur.dist) * rate;
    cur.yaw += (goal.yaw - cur.yaw) * rate;
    cur.pitch += (goal.pitch - cur.pitch) * rate;
    cur.fov += (goal.fov - cur.fov) * rate;
    cur.drift += (goal.drift - cur.drift) * rate;

    // A slow breath so the frame is never dead still — damped when the player
    // has asked for reduced motion.
    const reduced = reducedMotion();
    driftT += dt * (reduced ? 0.05 : 0.16);
    const driftAmount = cur.drift * (reduced ? 0.15 : 1);
    const dYaw = Math.sin(driftT) * 0.045 * driftAmount;
    const dPitch = Math.sin(driftT * 0.73 + 1.3) * 0.022 * driftAmount;

    const yaw = cur.yaw + user.yaw + dYaw;
    const pitch = cur.pitch + user.pitch + dPitch;
    const dist = cur.dist * user.zoom;

    const cp = Math.cos(pitch);
    camera.position.set(
      cur.target.x + Math.sin(yaw) * cp * dist,
      cur.target.y + Math.sin(pitch) * dist + dist * 0.06,
      cur.target.z + Math.cos(yaw) * cp * dist,
    );
    camera.lookAt(cur.target);
    if (Math.abs(camera.fov - cur.fov) > 0.01) {
      camera.fov = cur.fov;
      camera.updateProjectionMatrix();
    }
  }

  function dispose() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
  }

  return {
    update, setFraming, dispose,
    get framing() { return framing; },
    reset() { user.yaw = 0; user.pitch = 0; user.zoom = 1; },
  };
}
