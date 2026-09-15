// Aircraft carrier: the deck outline the physics tests against, the ship's motion in
// the swell, the arresting wires, the IFLOLS (meatball) and the deck/ground queries.
//
// What the ship LOOKS like is in src/art/carrier-look.js: hull, deck paint, island,
// wires and wake. The lamp positions of the meatball are here, because where each
// cell sits is what the pilot reads; their colours come from the palette.
import * as THREE from 'three';
import { DEG, RAD, KT, clamp, headingToVec } from '../config.js';
import { LightSet } from '../art/lights.js';
import { PALETTE } from '../art/palette.js';
import * as look from '../art/carrier-look.js';

const DECK_H = 20;      // deck height above waterline
const LEN = 333, WID = 77;

// Deck outline in ship-local coordinates (x right, z aft-positive; bow at z=-166)
const DECK_POLY = [
  [0, -166.5], [15, -160], [33, -110], [38.5, -40], [38.5, 150], [24, 166.5], [-24, 166.5], [-38.5, 125], [-38.5, -25], [-33, -75], [-15, -140],
];
const HULL_POLY = [[0, -166], [12, -150], [20, -60], [21, 150], [14, 166], [-14, 166], [-21, 150], [-20, -60], [-12, -150]];

function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export class Carrier {
  constructor(opts = {}) {
    this.heading = (opts.heading ?? 0) * DEG;
    this.speed = (opts.speedKt ?? 25) * KT;
    this.seaState = opts.seaState ?? 0.3;
    this.night = !!opts.night;
    this.pos = new THREE.Vector3(opts.x || 0, 0, opts.z || 0);
    this.vel = headingToVec(this.heading, new THREE.Vector3()).multiplyScalar(this.speed);
    this.t = 0;
    this.heave = 0; this.heaveRate = 0; this.pitch = 0; this.roll = 0;
    // landing area geometry (ship-local)
    this.angle = -9 * DEG; // angled deck to port
    this.rampLocal = new THREE.Vector3(10, DECK_H, 160);
    this.landDirLocal = new THREE.Vector3(Math.sin(this.angle), 0, -Math.cos(this.angle));
    this.landRightLocal = new THREE.Vector3(-this.landDirLocal.z, 0, this.landDirLocal.x);
    this.landHalfWidth = 14;
    this.wires = [50, 62, 74, 86];
    this.wireHalfWidth = 16;
    this.landLength = 240;
    this.touchdownU = (this.wires[1] + this.wires[2]) / 2;
    // Dimensions the art bench reads (see src/art/carrier-look.js). These are the
    // ship, not decoration: the deck outline is what the physics tests against.
    this.len = LEN; this.wid = WID; this.deckH = DECK_H;
    this.deckPoly = DECK_POLY; this.hullPoly = HULL_POLY;
    this.hullNumber = '68';
    this.group = new THREE.Group();
    this.quat = new THREE.Quaternion();
    this.qYaw = new THREE.Quaternion();
    this.mat = new THREE.Matrix4();
    this.matInv = new THREE.Matrix4();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this.landDirWorld = new THREE.Vector3();
    this.landRightWorld = new THREE.Vector3();
    this.rampWorld = new THREE.Vector3();
    this.tdWorld = new THREE.Vector3();
    this.update(0);
  }

  build(scene) {
    const g = this.group;
    const C = PALETTE.carrier;
    g.add(look.buildDeck(this));
    g.add(look.buildHull(this));
    g.add(look.buildGallery(this));
    const island = look.buildIsland(this);
    g.add(island.group);
    this.radar = island.radar;
    for (const o of look.buildWires(this)) g.add(o);
    // IFLOLS on the port side abeam the touchdown zone. The lamps are placed here:
    // which cell is lit at what height is the glideslope the pilot flies.
    const lensPos = this.landLocalPoint(this.touchdownU + 15, -(this.landHalfWidth + 18));
    this.lensLocal = lensPos.clone();
    g.add(look.buildLensHousing(this, lensPos));
    const ls = new LightSet(40, C.lensLightSize, 1);
    this.ballCells = [];
    for (let i = 0; i < 12; i++) this.ballCells.push(ls.add(lensPos.x, DECK_H + 0.4 + i * 0.32, lensPos.z, 0, 0, 0));
    this.datum = [];
    for (let i = 1; i <= 5; i++) {
      this.datum.push(ls.add(lensPos.x - i * 0.9 * this.landDirLocal.x, DECK_H + 0.4 + 5.5 * 0.32, lensPos.z - i * 0.9 * this.landDirLocal.z, C.datum[0], C.datum[1], C.datum[2]));
      this.datum.push(ls.add(lensPos.x + i * 0.9 * this.landDirLocal.x, DECK_H + 0.4 + 5.5 * 0.32, lensPos.z + i * 0.9 * this.landDirLocal.z, C.datum[0], C.datum[1], C.datum[2]));
    }
    this.waveoffLights = [];
    for (let i = 0; i < 4; i++) this.waveoffLights.push(ls.add(lensPos.x, DECK_H + 0.4 + i * 1.0, lensPos.z, 0, 0, 0));
    ls.finish();
    g.add(ls.points);
    this.lensSet = ls;
    // deck lighting: centreline white, edges amber, a red drop line down the stern
    const dl = new LightSet(400, C.deckLightSize, this.night ? C.deckNightOpacity : C.deckDayOpacity);
    for (let u = 0; u < this.landLength; u += 12) {
      const p = this.landLocalPoint(u, 0);
      dl.add(p.x, DECK_H + 0.1, p.z, C.deckCentreline[0], C.deckCentreline[1], C.deckCentreline[2]);
      const a = this.landLocalPoint(u, -this.landHalfWidth), b = this.landLocalPoint(u, this.landHalfWidth);
      dl.add(a.x, DECK_H + 0.1, a.z, C.deckEdge[0], C.deckEdge[1], C.deckEdge[2]);
      dl.add(b.x, DECK_H + 0.1, b.z, C.deckEdge[0], C.deckEdge[1], C.deckEdge[2]);
    }
    for (let i = 0; i < 8; i++) {
      const p = this.landLocalPoint(-2, 0);
      dl.add(p.x, DECK_H - 1 - i * 2, p.z + 6, C.dropLine[0], C.dropLine[1], C.dropLine[2]);
    }
    dl.finish();
    g.add(dl.points);
    this.wake = look.buildWake(this);
    g.add(this.wake);
    scene.add(g);
  }

  landLocalPoint(u, v) {
    return new THREE.Vector3(this.rampLocal.x + this.landDirLocal.x * u + this.landRightLocal.x * v, DECK_H, this.rampLocal.z + this.landDirLocal.z * u + this.landRightLocal.z * v);
  }

  update(dt) {
    this.t += dt;
    this.pos.addScaledVector(this.vel, dt);
    const s = this.seaState;
    const t = this.t;
    const heavePrev = this.heave;
    this.heave = 1.6 * s * Math.sin((2 * Math.PI * t) / 9.0) + 0.5 * s * Math.sin((2 * Math.PI * t) / 4.3 + 1);
    this.heaveRate = dt > 0 ? (this.heave - heavePrev) / dt : 0;
    this.pitch = 1.4 * DEG * s * Math.sin((2 * Math.PI * t) / 12.5 + 0.7);
    this.roll = 2.2 * DEG * s * Math.sin((2 * Math.PI * t) / 15.5 + 2.1);
    this.qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.heading);
    const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
    const qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll);
    this.quat.copy(this.qYaw).multiply(qp).multiply(qr);
    this.group.position.set(this.pos.x, this.heave, this.pos.z);
    this.group.quaternion.copy(this.quat);
    this.mat.compose(this.group.position, this.quat, new THREE.Vector3(1, 1, 1));
    this.matInv.copy(this.mat).invert();
    this.landDirWorld.copy(this.landDirLocal).applyQuaternion(this.qYaw);
    this.landRightWorld.copy(this.landRightLocal).applyQuaternion(this.qYaw);
    this.rampWorld.copy(this.rampLocal).applyMatrix4(this.mat);
    this.tdWorld.copy(this.landLocalPoint(this.touchdownU, 0)).applyMatrix4(this.mat);
    if (this.radar) this.radar.rotation.y += dt * 1.5;
    if (this.wake) this.wake.material.opacity = 0.25 + 0.1 * Math.sin(t * 2);
  }

  // world (x,z) -> local (yaw only) x,z
  toLocalXZ(x, z, out) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    // inverse of yaw(-heading): rotate by +heading
    out.x = dx * c - dz * s;
    out.z = dx * s + dz * c;
    return out;
  }
  deckWorldY(lx, lz) {
    this._tmp2.set(lx, DECK_H, lz).applyMatrix4(this.mat);
    return this._tmp2.y;
  }
  deckNormal(out) { return out.set(0, 1, 0).applyQuaternion(this.quat); }

  ground(x, z, out) {
    const l = this.toLocalXZ(x, z, this._tmp);
    if (inPoly(DECK_POLY, l.x, l.z)) {
      out.y = this.deckWorldY(l.x, l.z);
      this.deckNormal(out.n);
      out.mu = 0.8; out.kind = 'deck'; out.rough = 0;
      out.vel.copy(this.vel); out.vel.y = this.heaveRate;
      return true;
    }
    if (l.z > 166.5 && l.z < 176 && Math.abs(l.x) < 26) {
      out.y = this.deckWorldY(l.x, 166.5);
      out.n.set(0, 1, 0);
      out.mu = 0.8; out.kind = 'ramp'; out.rough = 0;
      out.vel.copy(this.vel);
      return true;
    }
    return false; // water handled by the terrain
  }

  // landing-area local coords for a world point
  deckLocal(p, out) {
    const l = this.toLocalXZ(p.x, p.z, this._tmp);
    const dx = l.x - this.rampLocal.x, dz = l.z - this.rampLocal.z;
    out.u = dx * this.landDirLocal.x + dz * this.landDirLocal.z;
    out.v = dx * this.landRightLocal.x + dz * this.landRightLocal.z;
    out.h = p.y - this.deckWorldY(l.x, l.z);
    out.onDeck = inPoly(DECK_POLY, l.x, l.z);
    return out;
  }

  // Meatball: glideslope deviation relative to 3.5 deg to the touchdown point. Returns cells (-6..6), inRange, waveoff.
  meatball(p, hookOffset = 3) {
    const dl = this.deckLocal(p, { u: 0, v: 0, h: 0, onDeck: false });
    const range = this.touchdownU - dl.u;
    if (range < 5) return { cells: 0, inRange: false, waveoff: false, range, dl };
    const h = dl.h - hookOffset;
    const ang = Math.atan2(h, range);
    const dev = (ang - 3.5 * DEG) * RAD;
    const cells = clamp(dev / 0.32, -6, 6);
    const inRange = range < 2200 && Math.abs(dl.v) < 120 && range > 0;
    const waveoff = inRange && ((cells < -3.5 && range < 700) || (Math.abs(dl.v) > 30 && range < 350) || (dl.h < 4 && dl.u < -5 && dl.u > -60));
    return { cells, inRange, waveoff, range, dl, dev };
  }

  updateLens(mb, t) {
    if (!this.lensSet) return;
    const C = PALETTE.carrier;
    const ls = this.lensSet;
    const c = mb.inRange ? mb.cells : 0;
    for (let i = 0; i < 12; i++) {
      const idx = this.ballCells[i];
      const cellPos = (i - 5.5) * 0.75; // 12 cells cover about +-4.5 cells
      const lit = mb.inRange && Math.abs(cellPos - c) < 0.5;
      const col = !lit ? C.ballOff : c < -2 ? C.ballLow : C.ball;
      ls.setColor(idx, col[0], col[1], col[2]);
    }
    const wo = mb.waveoff && Math.floor(t * 6) % 2 === 0;
    for (const idx of this.waveoffLights) ls.setColor(idx, wo ? C.waveoff[0] : 0, 0, 0);
  }

  // approach geometry helpers for scoring/spawning
  landingHeading() { return this.heading + this.angle; }
}
