// The valley below.
//
// The sect is not a menu with a number on it — it is a place that gets built.
// Five tiers of architecture (A9), and one instanced body per disciple, so the
// roster is legible by looking out of the window.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import { makeInkMaterial, makeGlowMaterial } from './shaders.js';

/** A hip roof with flared eaves: one cone for the pitch, one for the overhang. */
function roof(mat, width, height, group, y, z = 0, x = 0) {
  const pitch = new THREE.Mesh(new THREE.ConeGeometry(width * 0.78, height, 4, 1), mat);
  pitch.rotation.y = Math.PI / 4;
  pitch.position.set(x, y + height / 2, z);
  group.add(pitch);
  const eave = new THREE.Mesh(new THREE.ConeGeometry(width, height * 0.32, 4, 1), mat);
  eave.rotation.y = Math.PI / 4;
  eave.position.set(x, y + height * 0.16, z);
  group.add(eave);
  return pitch;
}

/** A single-storey hall: posts, body, roof. */
function hall(bodyMat, roofMat, w, h, d) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
  body.position.y = h / 2;
  g.add(body);
  roof(roofMat, Math.max(w, d) * 0.78, h * 0.62, g, h);
  return g;
}

/** A tapering pagoda. Each level is a body and a roof, 70% of the one below. */
function pagoda(bodyMat, roofMat, levels, baseW = 2.0, baseH = 1.1) {
  const g = new THREE.Group();
  let y = 0, w = baseW, h = baseH;
  for (let i = 0; i < levels; i++) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.46, h, 8), bodyMat);
    body.position.y = y + h / 2;
    g.add(body);
    roof(roofMat, w * 0.86, h * 0.5, g, y + h);
    y += h * 1.30;
    w *= 0.80;
    h *= 0.88;
  }
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.85, 6), roofMat);
  spire.position.y = y + 0.35;
  g.add(spire);
  return g;
}

export function createSect(env, tier) {
  const group = new THREE.Group();
  // Far enough out that the foreground cliff does not occlude the valley when
  // the Sect framing pulls back, and low enough to read as "below".
  group.position.set(2, -16.5, -52);

  const wallMat = makeInkMaterial(env, { color: '#4a4038', rim: 0.4, bands: 3 });
  const roofMat = makeInkMaterial(env, { color: '#2c3742', rim: 0.7, bands: 3, flat: true });
  const stoneMat = makeInkMaterial(env, { color: '#3a4049', rim: 0.35, bands: 3 });
  const jadeMat = makeInkMaterial(env, { color: '#2f6b63', rim: 0.9, bands: 4, emissive: 0.1 });

  /* the ground it stands on -------------------------------------------- */
  const plateau = new THREE.Mesh(new THREE.CylinderGeometry(17, 21, 5, 9, 1), stoneMat);
  plateau.position.y = -2.5;
  group.add(plateau);

  /* tier 0 — Humble Courtyard: one hut and a swept yard ------------------ */
  const t0 = new THREE.Group();
  const hut = hall(wallMat, roofMat, 2.2, 1.3, 1.9);
  hut.position.set(-1.5, 0, 1.0);
  t0.add(hut);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.1, 16), stoneMat);
  yard.position.set(1.0, 0.03, 0.5);
  t0.add(yard);
  group.add(t0);

  /* tier 1 — Rising Sect: a proper hall, lantern-lit ---------------------- */
  const t1 = new THREE.Group();
  const mainHall = hall(wallMat, roofMat, 5.2, 2.1, 3.4);
  mainHall.position.set(0, 0, -2.4);
  t1.add(mainHall);
  const wing = hall(wallMat, roofMat, 2.6, 1.5, 2.0);
  wing.position.set(4.2, 0, 0.4);
  t1.add(wing);
  t1.visible = false;
  group.add(t1);

  // Lamplight, and not the accent.
  //
  // These used to be painted with the day's accent colour, which made a valley
  // full of teal lanterns at noon and blue ones at night — and, more to the
  // point, put the player's own qi on a background element three hundred units
  // away. The accent belongs to her sash trim, her hairpin, her qi and her
  // particles; a lantern is fire, in every realm and at every hour.
  const LAMPLIGHT = '#ffb469';
  const lanternMat = makeGlowMaterial(env, { color: LAMPLIGHT, power: 1.2, strength: 1.5, core: 1 });
  const lanterns = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), lanternMat, 10);
  lanterns.count = 0;
  group.add(lanterns);
  const lanternSpots = [];
  {
    const rand = mulberry32(555);
    for (let i = 0; i < 10; i++) {
      const a = rand() * Math.PI * 2;
      const r = 4.0 + rand() * 7.0;
      lanternSpots.push(new THREE.Vector3(Math.cos(a) * r, 1.4 + rand() * 1.4, Math.sin(a) * r));
    }
  }

  /* tier 2 — Renowned Sect: a gate and a pagoda -------------------------- */
  const t2 = new THREE.Group();
  const tower = pagoda(wallMat, roofMat, 4);
  tower.position.set(-6.2, 0, -3.0);
  t2.add(tower);
  const gate = new THREE.Group();
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.24, 2.6, 6), wallMat);
    post.position.set(side * 1.5, 1.3, 0);
    gate.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.28, 0.4), roofMat);
  lintel.position.y = 2.5;
  gate.add(lintel);
  roof(roofMat, 2.6, 0.7, gate, 2.64);
  gate.position.set(1.5, 0, 7.6);
  t2.add(gate);
  t2.visible = false;
  group.add(t2);

  /* tier 3 — Grand Sect: walls, and more of everything ------------------- */
  const t3 = new THREE.Group();
  const R = 11.5;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    if (Math.abs(a - Math.PI * 0.5) < 0.4) continue; // leave the gate open
    const seg = new THREE.Mesh(new THREE.BoxGeometry(8.0, 1.5, 0.5), wallMat);
    seg.position.set(Math.cos(a) * R, 0.75, Math.sin(a) * R);
    seg.rotation.y = -a + Math.PI / 2;
    t3.add(seg);
    if (i % 3 === 0) {
      const tow = hall(wallMat, roofMat, 1.3, 1.9, 1.3);
      tow.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
      t3.add(tow);
    }
  }
  const annex = hall(wallMat, roofMat, 3.4, 1.8, 2.4);
  annex.position.set(6.4, 0, -5.0);
  t3.add(annex);
  t3.visible = false;
  group.add(t3);

  /* tier 4 — Immortal Orthodoxy: the peak comes off the ground ----------- */
  const t4 = new THREE.Group();
  const island = new THREE.Mesh(new THREE.ConeGeometry(6.0, 7.0, 7, 1), stoneMat);
  island.rotation.x = Math.PI;
  island.position.y = 15.0;
  t4.add(island);
  const palace = pagoda(jadeMat, roofMat, 5, 3.0, 1.4);
  palace.position.y = 18.2;
  t4.add(palace);
  const skirt = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.22, 6, 28), jadeMat);
  skirt.rotation.x = Math.PI / 2;
  skirt.position.y = 18.0;
  t4.add(skirt);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(6.2, 8.4, 40, 1),
    makeGlowMaterial(env, { color: '#ffd76a', power: 1.0, strength: 0.55, core: 0.85 }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 12.4;
  t4.add(halo);
  t4.visible = false;
  group.add(t4);

  /* disciples ------------------------------------------------------------ */

  // One lathe profile gives a robed figure with a head in a single draw call.
  const figureProfile = [
    new THREE.Vector2(0.001, 0.00), new THREE.Vector2(0.17, 0.03), new THREE.Vector2(0.155, 0.36),
    new THREE.Vector2(0.115, 0.52), new THREE.Vector2(0.055, 0.57), new THREE.Vector2(0.088, 0.64),
    new THREE.Vector2(0.072, 0.72), new THREE.Vector2(0.001, 0.745),
  ];
  const figureGeo = new THREE.LatheGeometry(figureProfile, 8);
  const discipleMat = makeInkMaterial(env, { color: '#59606c', rim: 0.6, bands: 3 });
  const disciples = new THREE.InstancedMesh(figureGeo, discipleMat, tier.disciples);
  disciples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  disciples.count = 0;
  group.add(disciples);

  // Each disciple gets a circuit: sweeping the yard, walking the wall, drilling
  // on the training ground. Different radii and speeds, so it never parades.
  const routes = [];
  {
    const rand = mulberry32(31337);
    for (let i = 0; i < tier.disciples; i++) {
      routes.push({
        r: 2.6 + rand() * 8.4,
        cx: (rand() - 0.5) * 6,
        cz: (rand() - 0.5) * 6,
        speed: (0.10 + rand() * 0.16) * (rand() > 0.5 ? 1 : -1),
        phase: rand() * Math.PI * 2,
        bob: 0.5 + rand(),
      });
    }
  }

  /* the expedition party ------------------------------------------------- */

  const partyMat = makeInkMaterial(env, { color: '#6a7280', rim: 0.7, bands: 3 });
  const party = new THREE.InstancedMesh(figureGeo, partyMat, 3);
  party.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  party.count = 0;
  group.add(party);

  /* ---------------------------------------------------------------- sync */

  const tmpMat = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3(1, 1, 1);
  const st = { tierIndex: -1, disciples: 0, expedition: null, phase: 0 };

  function setPalette(p) {
    jadeMat.uniforms.uColor.value.set(p.robe);
    roofMat.uniforms.uColor.value.set(p.ridges[1]);
    lanternMat.uniforms.uColor.value.set(LAMPLIGHT);
  }

  function sync(vm) {
    const t = vm.sect.founded ? vm.sect.tierIndex : -1;
    st.tierIndex = t;
    group.visible = t >= 0;
    t0.visible = t >= 0;
    t1.visible = t >= 1;
    t2.visible = t >= 2;
    t3.visible = t >= 3;
    t4.visible = t >= 4;
    lanterns.count = t >= 1 ? Math.min(10, 3 + t * 2) : 0;
    for (let i = 0; i < lanterns.count; i++) {
      tmpMat.compose(lanternSpots[i], tmpQ.identity(), tmpS);
      lanterns.setMatrixAt(i, tmpMat);
    }
    if (lanterns.count) lanterns.instanceMatrix.needsUpdate = true;

    st.disciples = Math.min(tier.disciples, vm.sect.disciples);
    disciples.count = st.disciples;
    st.expedition = vm.expedition;
    party.count = vm.expedition ? 3 : 0;
  }

  function update(dt, t) {
    if (!group.visible) return;

    for (let i = 0; i < disciples.count; i++) {
      const r = routes[i];
      const a = t * r.speed + r.phase;
      tmpV.set(r.cx + Math.cos(a) * r.r, 0.02 + Math.abs(Math.sin(t * 4 * r.bob)) * 0.05, r.cz + Math.sin(a) * r.r);
      tmpQ.setFromEuler(new THREE.Euler(0, -a, 0));
      disciples.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS));
    }
    if (disciples.count) disciples.instanceMatrix.needsUpdate = true;

    // The party leaves by the gate, walks out of the valley, and comes back
    // along the same line when the timer is done.
    if (party.count && st.expedition) {
      const total = st.expedition.total || 1;
      const done = 1 - Math.max(0, st.expedition.remaining) / total;
      // Out for the first 40%, away in the middle, home over the last 25%.
      let along;
      if (done < 0.4) along = done / 0.4;
      else if (done > 0.75) along = 1 - (done - 0.75) / 0.25;
      else along = 1;
      const dist = 8 + along * 26;
      for (let i = 0; i < 3; i++) {
        const lag = i * 0.9;
        tmpV.set(1.5 + Math.sin(t * 0.6 + i) * 0.35, 0.02, 7.6 + dist + lag);
        tmpQ.setFromEuler(new THREE.Euler(0, along >= 1 ? 0 : Math.PI * (done < 0.4 ? 0 : 1), 0));
        party.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS));
      }
      party.instanceMatrix.needsUpdate = true;
    }

    if (t4.visible) {
      t4.position.y = Math.sin(t * 0.25) * 0.35;
      t4.rotation.y = t * 0.02;
    }
  }

  return { group, setPalette, sync, update };
}
