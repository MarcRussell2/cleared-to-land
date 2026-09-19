// The aerodrome: where the runway is, where every light sits and what colour it is
// showing, the PAPI and ILS geometry, and the ground query the physics calls.
//
// What it all LOOKS like is next door in src/art/airport-look.js: the pavement, the
// shoulders and apron, the buildings, the windsock, the edge markers. The light
// positions are here because they are aeronautical facts — edge lights every 60 m,
// green at the threshold, red at the end — while their colours come from the art
// bench's palette.
import * as THREE from 'three';
import { DEG, RAD, clamp, headingToVec, noise2 } from '../config.js';
import { LightSet, getDisc } from '../art/lights.js';
import { PALETTE } from '../art/palette.js';
import * as look from '../art/airport-look.js';
import { buildModel, shipsGltf } from '../aircraft/models.js';
import { SKYLARK, CONDOR } from '../aircraft/defs.js';
import { mergeParts, freeze } from '../geom.js';

// A static aircraft for the apron. The art bench asks for one of these by kind
// rather than importing the aircraft module, which is not part of its remit.
//
// Performance (docs/PERF.md): a parked airframe is built exactly like the flying one -
// 29 to 71 draws, six one-point `Points` for its navigation lights, and a landing-light
// SpotLight that every lit pixel on screen pays for even at intensity 0 (six parked
// aircraft put NUM_SPOT_LIGHTS at 7 in every shader). So: the lights go at once, the
// six nav-light points become one, and once the downloaded airframe has arrived the
// static meshes are merged into one draw per material (Airport.settleParked). Same
// materials, same triangles, same places.
function parkedAircraft(kind, pending) {
  const def = kind === 'airliner' ? CONDOR : SKYLARK;
  const m = buildModel(def);
  if (m.parts.props) for (const pr of m.parts.props) { if (pr.userData.disc) pr.userData.disc.visible = false; }
  const g = m.group;
  const lights = [];
  g.traverse((o) => { if (o.isLight) lights.push(o, o.target); });
  for (const o of lights) if (o && o.parent) o.parent.remove(o);
  if (m.parts.lights) {
    const pts = Object.values(m.parts.lights).filter((l) => l && l.isPoints && l.parent === g);
    if (pts.length) {
      const pos = new Float32Array(pts.length * 3), col = new Float32Array(pts.length * 3);
      pts.forEach((l, i) => { l.position.toArray(pos, i * 3); l.material.color.toArray(col, i * 3); g.remove(l); });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const merged = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 6, sizeAttenuation: false, vertexColors: true, map: getDisc(), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false, fog: true,
      }));
      merged.name = 'parked-lights';
      g.add(merged);
    }
  }
  pending.push(m);
  return { group: g, cgHeight: def.cgHeight };
}

// Materials that would compile to the same program and carry the same values render the
// same; one representative per such set lets the merge below reach one draw per look.
function materialKey(m) {
  const key = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
  return [m.type, key, m.color ? m.color.getHex() : '', m.roughness, m.metalness, m.side, m.transparent, m.opacity, m.depthWrite, m.blending, m.map ? m.map.uuid : '', m.emissive ? m.emissive.getHex() : ''].join('|');
}

// Fold a static model into one mesh per material: every visible mesh, in the model's own
// frame (the paint shaders project body-frame coordinates, so the frame matters), hidden
// parts dropped, non-mesh children (the merged nav lights) kept.
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byKey = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || !o.geometry || !o.geometry.attributes.position) return;
    for (let p = o; p && p !== group; p = p.parent) if (!p.visible) return;
    // ...and by attribute set: a merged geometry carries the union of its parts' attributes, and a
    // material compiled for "has uv" is another program than the same material without.
    const k = materialKey(o.material) + '|' + Object.keys(o.geometry.attributes).sort().join(',');
    let e = byKey.get(k);
    if (!e) { e = { material: o.material, parts: [] }; byKey.set(k, e); }
    e.parts.push({ geometry: o.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
  });
  if (!byKey.size) return;
  const keep = group.children.filter((c) => c.isPoints);
  group.clear();
  for (const { material, parts } of byKey.values()) {
    const mesh = new THREE.Mesh(mergeParts(parts), material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'parked:' + (material.name || material.type);
    group.add(mesh);
  }
  for (const c of keep) group.add(c);
}

export class Airport {
  constructor(runwayDefs, terrain, opts = {}) {
    this.terrain = terrain;
    this.opts = opts;
    this.group = new THREE.Group();
    this.runways = runwayDefs.map((d) => {
      const heading = d.heading * DEG;
      const dir = headingToVec(heading, new THREE.Vector3());
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      const threshold = new THREE.Vector3(d.x, d.elevation, d.z);
      const end = threshold.clone().addScaledVector(dir, d.length);
      end.y = d.elevation + (d.slope || 0) * d.length;
      const aimDistance = d.aimDistance || Math.min(400, d.length * 0.15);
      const aim = threshold.clone().addScaledVector(dir, aimDistance);
      aim.y = d.elevation + (d.slope || 0) * aimDistance;
      const nameNum = Math.round(d.heading / 10) % 36 || 36;
      const recip = (nameNum + 18) % 36 || 36;
      return {
        ...d, heading, dir, right, threshold, end, aim, aimDistance,
        name: d.name || String(nameNum).padStart(2, '0'), nameRecip: d.nameRecip || String(recip).padStart(2, '0'),
        slope: d.slope || 0, surface: d.surface || 'asphalt',
      };
    });
    this.primary = this.runways[0];
    this.papi = [];
    this.strobes = [];
    this.pending = [];   // parked aircraft waiting for their downloaded airframe before being merged
    this.t = 0;
  }

  // The world point u metres along the runway from the threshold, v metres right
  // of the centreline. Everything an aerodrome draws is positioned through this.
  point(rw, u, v, out) {
    out.copy(rw.threshold).addScaledVector(rw.dir, u).addScaledVector(rw.right, v);
    out.y = rw.elevation + rw.slope * u;
    return out;
  }

  build(scene, opts = {}) {
    const night = opts.night;
    const tmp = new THREE.Vector3();
    for (const rw of this.runways) {
      const place = (u, v, out) => this.point(rw, u, v, out);
      // The runway quad follows the runway's slope exactly, so its shape is built
      // here; the art bench decides what it is painted with.
      const geo = new THREE.PlaneGeometry(rw.length, rw.width, 48, 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) + rw.length / 2, v = -pos.getY(i);
        place(u, v, tmp);
        pos.setXYZ(i, tmp.x, tmp.y + 0.06, tmp.z);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, look.runwayMaterial(rw));
      mesh.receiveShadow = true;
      this.group.add(mesh);
      if (rw.surface === 'asphalt') this.add(look.buildShoulders(rw, place));
      this.buildLights(rw, night);
      if (rw.papi !== false) this.buildPapi(rw);
      if (rw.windsock !== false) {
        this.windsock = look.buildWindsock(rw, place);
        this.group.add(this.windsock.group);
      }
      if (rw.buildings) {
        const b = look.buildBuildings(rw, place, (kind) => parkedAircraft(kind, this.pending));
        this.add(b.objects);
        this.terrain.obstacles.push(...b.obstacles);
        this.towerPos = b.towerPos;
        this.buildSurroundings(rw);
      } else if (rw.surface !== 'asphalt') {
        const camp = look.buildBushCamp(rw, place);
        this.add(camp.objects);
        this.terrain.obstacles.push(...camp.obstacles);
      }
      if (rw.markers) this.add(look.buildMarkers(rw, place));
      // The new maps (src/missions/sites.js): a site's own props (solid ones register like buildings), and
      // roads and villages placed by the site even where there are no aerodrome buildings.
      if (rw.props) {
        const p = look.buildSiteProps(rw, place, rw.props, (x, z) => this.terrain.height(x, z));
        this.add(p.objects);
        this.terrain.obstacles.push(...p.obstacles);
      }
      if (rw.surroundings && !rw.buildings) this.buildSurroundings(rw);
    }
    scene.add(this.group);
    // An aerodrome does not move: matrices composed once (the windsock's sock turns with the wind and stays live).
    freeze(this.group, new Set([this.windsock ? this.windsock.sock : null]));
  }

  add(objects) { for (const o of objects) this.group.add(o); }

  // Once a parked airframe's downloaded model is in (or glTF is off, or it never comes),
  // fold its meshes into one draw per material and freeze it. Merging before the model
  // arrives would be undone by its arrival, so this waits.
  settleParked() {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const m = this.pending[i];
      // the art bench may have flattened the model into its own object and never added this group
      // (airport-look's flattenParked does, since the exteriors became procedural): nothing to settle
      if (!m.group.parent) { this.pending.splice(i, 1); continue; }
      if (!(m.gltfRoot || !shipsGltf(m.def.id) || this.t > 12)) continue;
      this.pending.splice(i, 1);
      mergeStatic(m.group);
      freeze(m.group);
    }
  }

  // Edge, threshold, end, centreline, approach and taxiway lighting. Where these
  // sit is regulation; the colours come from the palette.
  buildLights(rw, night) {
    const L = PALETTE.lights;
    const ls = new LightSet(900, L.size.runway, night ? L.nightOpacity : L.dayOpacity);
    const tmp = new THREE.Vector3();
    const addL = (u, v, h, c) => { this.point(rw, u, v, tmp); return ls.add(tmp.x, tmp.y + h, tmp.z, c[0], c[1], c[2]); };
    if (rw.lights !== false) {
      const step = rw.length > 1200 ? 60 : 30;
      for (let u = 0; u <= rw.length; u += step) {
        const amber = u > rw.length - 600 && rw.length > 1200;
        const c = amber ? L.edgeCaution : L.edge;
        addL(u, -rw.width / 2 - 2.5, 0.4, c);
        addL(u, rw.width / 2 + 2.5, 0.4, c);
      }
      const n = Math.max(6, Math.round(rw.width / 3));
      for (let i = 0; i <= n; i++) {
        const v = -rw.width / 2 + (i / n) * rw.width;
        addL(-1, v, 0.3, L.threshold);
        addL(rw.length + 1, v, 0.3, L.end);
      }
      if (rw.ils) for (let u = 15; u < rw.length; u += 30) addL(u, 0, 0.1, L.centreline);
      if (rw.approachLights !== false && rw.length > 1000) {
        for (let u = -30; u >= -720; u -= 30) {
          for (const v of [-1.5, 0, 1.5]) addL(u, v, 0.5, L.approach);
          if (u === -300) for (let v = -15; v <= 15; v += 1.5) addL(u, v, 0.5, L.approach);
        }
        for (let u = -60; u >= -720; u -= 60) this.strobes.push({ set: ls, i: addL(u, 0, 0.6, L.approach), phase: (-u / 720) });
      }
      this.strobes.push({ set: ls, i: addL(-2, -rw.width / 2 - 12, 0.6, L.approach), phase: 0, reil: true });
      this.strobes.push({ set: ls, i: addL(-2, rw.width / 2 + 12, 0.6, L.approach), phase: 0, reil: true });
    }
    if (night && rw.surface === 'asphalt' && rw.taxiway !== false) {   // (taxiway: false, the new maps: none to light)
      const twy = rw.width / 2 + 90;
      for (let u = 0; u <= rw.length; u += 40) { addL(u, twy - 12, 0.3, L.taxiway); addL(u, twy + 12, 0.3, L.taxiway); }
    }
    ls.finish();
    this.group.add(ls.points);
    this.lightSet = ls;
  }

  // PAPI: four lamps abeam the aiming point, each showing white above its own
  // angle and red below it. Two white / two red is the glidepath.
  buildPapi(rw) {
    const L = PALETTE.lights;
    const ls = new LightSet(8, L.size.papi, 1);
    const tmp = new THREE.Vector3();
    const v0 = -rw.width / 2 - 15;
    const u = rw.aimDistance;
    const angles = [3.5, 3.17, 2.83, 2.5].map((a) => a * DEG);
    if (rw.papiAngle) { const off = rw.papiAngle * DEG - 3 * DEG; for (let i = 0; i < 4; i++) angles[i] += off; }
    const lights = [];
    for (let i = 0; i < 4; i++) {
      this.point(rw, u, v0 - i * 9, tmp);
      const idx = ls.add(tmp.x, tmp.y + 0.6, tmp.z, 1, 1, 1);
      lights.push({ idx, angle: angles[i], pos: tmp.clone() });
    }
    ls.finish();
    this.group.add(ls.points);
    this.papi.push({ set: ls, lights, rw });
    this.add(look.buildPapiBoxes(lights.map((l) => l.pos)));
  }

  // Roads and villages around an airport. The art draws them; where they run is
  // decided here, because they have to miss the runway and the approach path.
  buildSurroundings(rw) {
    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
    const T = this.terrain;
    const road = (u0, v0, u1, v1, w) => { this.point(rw, u0, v0, tmp); this.point(rw, u1, v1, tmp2); T.addRoad(tmp.x, tmp.z, tmp2.x, tmp2.z, w); };
    // a site may place its own (the new maps: a coast road, a road through a saddle; runway frame)
    if (rw.surroundings) {
      // (a polyline {w, pts} is drawn by the site's own props, look.buildSiteProps, facing up and draped)
      for (const r of rw.surroundings.roads || []) if (Array.isArray(r)) road(...r);
      for (const [u, v, n, spread] of rw.surroundings.villages || []) { this.point(rw, u, v, tmp); T.addVillage(tmp.x, tmp.z, n, spread); }
      return;
    }
    // a road crossing the approach path, a parallel road, an access road to the terminal
    road(-950, -2600, -950, 2600, 8);
    road(-3500, 700, 4000, 700, 8);
    road(rw.length * 0.58, 700, rw.length * 0.58, rw.width / 2 + 90 + 260, 6);
    road(rw.length + 900, -2600, rw.length + 900, 2600, 7);
    // villages
    this.point(rw, 1300, 1700, tmp); T.addVillage(tmp.x, tmp.z, 140, 420);
    this.point(rw, -2300, -1200, tmp); T.addVillage(tmp.x, tmp.z, 60, 260);
    this.point(rw, rw.length + 1600, 1500, tmp); T.addVillage(tmp.x, tmp.z, 90, 320);
  }

  ground(x, z, out) {
    for (const rw of this.runways) {
      const dx = x - rw.threshold.x, dz = z - rw.threshold.z;
      const u = dx * rw.dir.x + dz * rw.dir.z;
      const v = dx * rw.right.x + dz * rw.right.z;
      if (u < -5 || u > rw.length + 5 || Math.abs(v) > rw.width / 2 + 1) continue;
      let y = rw.elevation + rw.slope * u;
      const s = rw.surface;
      out.n.set(0, 1, 0);
      if (rw.slope) { out.n.copy(rw.dir).multiplyScalar(-rw.slope).add(new THREE.Vector3(0, 1, 0)).normalize(); }
      out.vel.set(0, 0, 0);
      if (s === 'asphalt') { out.mu = rw.wet ? 0.5 : 0.85; out.kind = 'runway'; out.rough = 0; }
      else if (s === 'gravel') { out.mu = 0.62; out.kind = 'gravel'; out.rough = 0.45; y += 0.035 * noise2(x * 1.7, z * 1.7, 3); }
      else if (s === 'sand') { out.mu = 0.5; out.kind = 'sand'; out.rough = 0.6; y += 0.05 * noise2(x * 1.2, z * 1.2, 5); }
      // the new maps: packed snow brakes at about a third of dry asphalt, lake ice at a seventh
      else if (s === 'snow') { out.mu = 0.3; out.kind = 'snow'; out.rough = 0.35; y += 0.03 * noise2(x * 1.3, z * 1.3, 6); }
      else if (s === 'ice') { out.mu = 0.12; out.kind = 'ice'; out.rough = 0.05; }
      else { out.mu = 0.55; out.kind = 'dirt'; out.rough = 0.7; y += 0.06 * noise2(x * 1.5, z * 1.5, 4); }
      out.y = y;
      return true;
    }
    return false;
  }

  deviation(rw, p) {
    const dx = p.x - rw.threshold.x, dz = p.z - rw.threshold.z;
    const u = dx * rw.dir.x + dz * rw.dir.z;
    const v = dx * rw.right.x + dz * rw.right.z;
    const locDist = Math.max(50, rw.length + 300 - u);
    const locAngle = Math.atan2(v, locDist) * RAD;
    const gsDist = Math.max(20, rw.aimDistance - u);
    const gsAngle = Math.atan2(p.y - rw.aim.y, gsDist) * RAD;
    const gsRef = rw.gsAngle || 3;
    return { u, v, locDots: clamp(locAngle / 0.5, -5, 5), gsDots: clamp((gsAngle - gsRef) / 0.14, -5, 5), gsAngle, locAngle, dist: -u };
  }

  update(dt, acPos, wind, t) {
    const L = PALETTE.lights;
    this.t += dt;
    if (this.pending.length) this.settleParked();
    for (const p of this.papi) {
      for (const l of p.lights) {
        const dx = acPos.x - l.pos.x, dz = acPos.z - l.pos.z;
        const dist = Math.hypot(dx, dz);
        const ang = Math.atan2(acPos.y - l.pos.y, dist);
        const c = ang > l.angle ? L.papiWhite : L.papiRed;
        p.set.setColor(l.idx, c[0], c[1], c[2]);
      }
    }
    for (const s of this.strobes) {
      const ph = (this.t * 2 - s.phase * 1.2) % 1;
      const on = s.reil ? ((this.t * 2) % 1) < 0.08 : ph < 0.12;
      const c = on ? L.strobe : L.off;
      s.set.setColor(s.i, c[0], c[1], c[2]);
    }
    if (this.windsock && wind) {
      const { spd, dir } = wind.surface(t);
      const psi = (dir + 180) * DEG;
      this.windsock.sock.rotation.set(0, 0, 0);
      this.windsock.sock.rotation.y = -psi + Math.PI;
      const droop = (1 - clamp(spd / 15, 0, 1)) * 1.2;
      this.windsock.sock.rotateX(-droop);
    }
  }
}
