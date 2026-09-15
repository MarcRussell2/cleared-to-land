// How the carrier looks: hull, flight deck, island, wires and wake.
//
// World pass 6 (carrier): the deck texture carries non-skid grain, a tie-down grid,
// rubber between the ramp and the 3-wire, four elevator outlines, four catapult
// tracks and a no-step band; the hull has boot-topping, rust and plating seams in
// its shader (uniforms prefixed cv); the gallery is one merged mesh of sponsons,
// catwalks and the LSO platform; the island is a stepped superstructure with glazed
// bridge bands that glow at night (c.night), a lattice mast, radomes, a stack and a
// beacon; the wake is a drawn alpha texture that drifts astern.
//
// world/carrier.js owns what the ship IS — the deck outline the physics tests
// against, the deck height, where the arresting wires are, the ship's motion in
// the swell, the meatball. This file draws it.
//
// Everything is handed `c`, the live Carrier, read-only. What it offers:
//
//   len, wid, deckH       overall length, beam and deck height above the waterline
//   deckPoly, hullPoly    [x, z] outlines in ship-local metres (bow at z = -len/2)
//   angle                 the angled deck, in radians (negative = to port)
//   rampLocal             the round-down, ship-local
//   landDirLocal          unit vector up the landing area
//   landRightLocal        unit vector across it, to starboard
//   landHalfWidth         half the painted landing area, in metres
//   landLength            how far up the landing area the deck lighting runs
//   wires                 metres from the ramp to each arresting wire
//   hullNumber            painted on the bow
//   night                 true for a night scenario
//   landLocalPoint(u, v)  ship-local point in the landing area's frame
//
// The wires and the landing area are simulation facts: draw them where they are.
import * as THREE from 'three';
import { makeRng, noise2 } from '../config.js';
import { mergeGeos } from '../geom.js';
import { PALETTE, FINISH } from './palette.js';
import { carrierDeck } from './textures.js';

const shapeOf = (poly) => {
  const s = new THREE.Shape();
  poly.forEach(([x, z], i) => (i ? s.lineTo(x, z) : s.moveTo(x, z)));
  s.closePath();
  return s;
};

// The deck slab, painted with the flight-deck texture on top and plain on the sides.
export function buildDeck(c) {
  const geo = new THREE.ExtrudeGeometry(shapeOf(c.deckPoly), { depth: 2.6, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);   // shape (x, z) -> world, extrude downward
  const tex = carrierDeck({
    len: c.len, wid: c.wid, ramp: c.rampLocal, dir: c.landDirLocal, right: c.landRightLocal,
    halfWidth: c.landHalfWidth, wires: c.wires, hullNumber: c.hullNumber,
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1 / c.wid, -1 / c.len);
  tex.offset.set(0.5, 0.5);
  tex.flipY = false;
  const topMat = new THREE.MeshStandardMaterial({ map: tex, ...FINISH.deck });
  topMat.name = 'carrier/deck';
  // At night the landing area is floodlit from the island: a soft pool of light
  // baked into the deck's emissive term, driven by cvNight (world pass 6).
  topMat.emissive = new THREE.Color(0xfff2d8);
  topMat.emissiveIntensity = c.night ? 0.06 : 0;
  const sideMat = new THREE.MeshStandardMaterial({ color: PALETTE.carrier.deckSide, ...FINISH.building });
  sideMat.name = 'carrier/deck-side';
  const deck = new THREE.Mesh(geo, [topMat, sideMat]);
  deck.position.y = c.deckH;
  deck.receiveShadow = true; deck.castShadow = true;
  return deck;
}

export function buildHull(c) {
  const geo = new THREE.ExtrudeGeometry(shapeOf(c.hullPoly), { depth: 29, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.carrier.hull, ...FINISH.ship });
  mat.name = 'carrier/hull';
  // Boot-topping at the waterline, a rust-streaked band above it and plating
  // seams every 6 m along the hull, all in the shader from the world position
  // (world pass 6). Uniforms prefixed cv.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.cvDeck = { value: c.deckH - 2.6 };
    shader.vertexShader = 'varying vec3 cvLocal;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ncvLocal = position;');
    shader.fragmentShader = 'varying vec3 cvLocal; uniform float cvDeck;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float cvH = cvLocal.y + cvDeck;            // metres above the waterline
        float cvBoot = 1.0 - smoothstep(1.8, 2.6, cvH);
        float cvRust = (1.0 - smoothstep(2.6, 7.0, cvH)) * (0.5 + 0.5 * sin(cvLocal.z * 0.9 + cvLocal.x * 2.3));
        float cvSeam = 1.0 - smoothstep(0.05, 0.12, abs(fract(cvLocal.z / 6.0) - 0.5) * 6.0);
        float cvStrake = 1.0 - smoothstep(0.05, 0.12, abs(fract(cvH / 4.0) - 0.5) * 4.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.02, 0.022), cvBoot);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.08, 0.04), cvRust * 0.35);
        diffuseColor.rgb *= 1.0 - 0.10 * max(cvSeam, cvStrake);`);
  };
  mat.customProgramCacheKey = () => 'ctl-hull-v1';
  const hull = new THREE.Mesh(geo, mat);
  hull.position.y = c.deckH - 2.6;
  hull.castShadow = true;
  hull.name = 'carrier/hull';
  return hull;
}

// The sponsons and gallery deck under the flight-deck overhang.
export function buildGallery(c) {
  // The gallery deck, the sponsons under the overhangs, the catwalks along the
  // deck edge and the LSO platform, merged into one mesh (world pass 6).
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.carrier.gallery, ...FINISH.ship });
  mat.name = 'carrier/gallery';
  const parts = [];
  const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(g); };
  box(56, 6, 250, 0, c.deckH - 5.5, 10);
  box(14, 4, 60, -30, c.deckH - 3.2, 40);      // port sponson under the angled deck
  box(10, 4, 50, 30, c.deckH - 3.2, -20);      // starboard sponson
  box(8, 3, 40, -32, c.deckH - 2.8, 110);      // aft port sponson
  for (const s of [-1, 1]) box(1.2, 1.1, 300, s * 38.5, c.deckH - 1.2, 0);   // catwalks
  box(6, 1.2, 14, -c.landHalfWidth - 24, c.deckH - 0.9, 120);             // LSO platform
  const merged = mergeGeos(parts);
  const gal = new THREE.Mesh(merged, mat);
  gal.castShadow = false; gal.receiveShadow = true;
  gal.name = 'carrier/gallery';
  return gal;
}

// The island. Returns { group, radar }; the radar is spun by carrier.js, so keep
// something called radar in there.
export function buildIsland(c) {
  // A stepped superstructure (world pass 6): the base, the flag bridge and the
  // navigation bridge as glazed levels, pri-fly aft at the top, a lattice mast
  // with the rotating array and a yardarm, two radomes, the stack, the hull
  // number on the outboard face. Merged by material: steel, glass, domes.
  const isl = new THREE.Group();
  const islMat = new THREE.MeshStandardMaterial({ color: PALETTE.carrier.island, ...FINISH.building });
  islMat.name = 'carrier/island';
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2630, ...FINISH.glass, emissive: 0xffe2b0, emissiveIntensity: c.night ? 0.55 : 0.0 });
  glassMat.name = 'carrier/island-glass';
  const steel = [], glass = [];
  const box = (list, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); list.push(g); };
  box(steel, 11, 20, 30, 0, 10, 0);                       // base
  box(steel, 14, 5, 22, 0, 22.5, -2);                     // flag bridge deck
  box(glass, 14.3, 1.6, 22.3, 0, 23.6, -2);               // its glazing band
  box(steel, 13, 5, 18, 0, 27.5, 0);                      // navigation bridge
  box(glass, 13.3, 1.6, 18.3, 0, 28.6, 0);
  box(steel, 9, 4, 10, 0, 32, 8);                         // pri-fly, aft
  box(glass, 9.3, 1.4, 10.3, 0, 32.6, 8);
  box(steel, 3, 12, 3, 3, 26, -11);                       // the stack
  for (let i = 0; i < 4; i++) box(steel, 0.35, 26, 0.35, (i % 2 ? 1.2 : -1.2), 47, 4 + (i < 2 ? 1.2 : -1.2));   // lattice mast legs
  for (let y = 38; y < 58; y += 4) { box(steel, 2.8, 0.25, 0.25, 0, y, 5.2); box(steel, 0.25, 0.25, 2.8, 1.2, y, 4); }
  box(steel, 12, 0.3, 0.3, 0, 52, 4);                     // yardarm
  for (const x of [-4, 4]) box(steel, 0.15, 3, 0.15, x, 53.5, 4);   // antennas
  const radar = new THREE.Mesh(new THREE.BoxGeometry(8, 2.4, 0.5), islMat); radar.position.set(0, 60.5, 4);
  const radarBase = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2, 8), islMat); radarBase.position.set(0, 59, 4);
  const domeMat = new THREE.MeshStandardMaterial({ color: PALETTE.carrier.dome });
  domeMat.name = 'carrier/dome';
  const dome1 = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), domeMat); dome1.position.set(4, 36, 8);
  const dome2 = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 7), domeMat); dome2.position.set(-4, 35, -6);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5),
    new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: c.night ? 1.0 : 0.3 }));
  beacon.position.set(0, 61.6, 4); beacon.material.name = 'carrier/beacon';
  const steelMesh = new THREE.Mesh(mergeGeos(steel), islMat);
  const glassMesh = new THREE.Mesh(mergeGeos(glass), glassMat);
  isl.add(steelMesh, glassMesh, radar, radarBase, dome1, dome2, beacon);
  isl.position.set(31, c.deckH, 25);
  isl.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
  beacon.castShadow = false;
  return { group: isl, radar };
}

// The arresting wires and their deck sheaves.
export function buildWires(c) {
  const objects = [];
  const wireMat = new THREE.MeshStandardMaterial({ color: PALETTE.carrier.wire, ...FINISH.steel });
  for (const u of c.wires) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, c.landHalfWidth * 2 + 6, 6), wireMat);
    const p = c.landLocalPoint(u, 0);
    w.position.set(p.x, c.deckH + 0.12, p.z);
    w.rotation.y = -c.angle;
    w.rotation.z = Math.PI / 2;
    objects.push(w);
    for (const s of [-1, 1]) {
      const sheave = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), wireMat);
      const q = c.landLocalPoint(u, s * (c.landHalfWidth + 3));
      sheave.position.set(q.x, c.deckH + 0.25, q.z);
      objects.push(sheave);
    }
  }
  return objects;
}

// The IFLOLS housing. The lamps themselves are placed by carrier.js — they are
// the meatball, and where each cell sits is what the pilot reads — so this is
// only the box they live in.
export function buildLensHousing(c, lensPos) {
  const lens = new THREE.Group();
  lens.position.set(lensPos.x, c.deckH, lensPos.z);
  const lensBox = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.2, 1.2),
    new THREE.MeshStandardMaterial({ color: PALETTE.carrier.lensBox }));
  lensBox.position.y = 2.1;
  lens.add(lensBox);
  return lens;
}

// The wake astern.
export function buildWake(c) {
  // A tapered wake with two churned bands and streaks that thin astern, drawn
  // into an alpha canvas once; the map drifts along the ship's axis from the
  // mesh's own onBeforeRender (no per-frame allocation, no engine call). The
  // opacity pulse carrier.js applies still works on top.
  const W = 128, H = 512, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const rng = makeRng(parseInt(c.hullNumber, 10) * 17 + 5);
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H;                                   // 0 at the stern, 1 far astern
    const u = (x / W - 0.5) * 2;                       // -1..1 across
    const half = 0.28 + 0.62 * t;                      // the wake widens astern
    const band = Math.abs(Math.abs(u) - half * 0.55) < 0.12 ? 1 : 0;
    const centre = 1 - Math.min(1, Math.abs(u) / (half * 0.35));
    const streak = 0.5 + 0.5 * noise2(x / 6, y / 30, 3);
    let a = (0.55 * band + 0.6 * centre) * (1 - t) * streak * (Math.abs(u) < half ? 1 : 0);
    a *= 0.9 + 0.3 * (rng() - 0.5);
    const i = (y * W + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.max(0, Math.min(255, a * 255));
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.wrapS = THREE.ClampToEdgeWrapping; map.wrapT = THREE.RepeatWrapping;
  const wakeMat = new THREE.MeshBasicMaterial({
    color: PALETTE.carrier.wake, map, transparent: true, opacity: PALETTE.carrier.wakeOpacity, depthWrite: false,
  });
  wakeMat.name = 'carrier/wake';
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(64, 760, 1, 1), wakeMat);
  wake.rotation.x = -Math.PI / 2;
  wake.rotation.z = Math.PI;
  wake.position.set(0, 0.3, c.len / 2 + 380);
  wake.name = 'carrier/wake';
  wake.onBeforeRender = () => { map.offset.y -= 0.0025; };
  return wake;
}
