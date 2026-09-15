// Shared point-light rendering (runway lights, deck lights, nav lights) and the soft disc sprite texture.
//
// A LightSet is a THREE.Points batch: one draw for hundreds of lamps, each a sprite
// with a hard core and a soft halo (getDisc). The point size is the palette's, then
// scaled by distance in the vertex shader (world pass 5): a lamp 100 m away is about
// half again as big as the nominal size, one 3 km away shrinks to a third of it, so
// the approach lights read as a row of pinpoints from the outer marker and as lamps
// with halos in the flare. sizeAttenuation stays off (the scaling is our own,
// clamped) so nothing vanishes at range. Exports and method names are frozen: the
// world (airport.js, carrier.js) and the aircraft's navigation lights use them.
import * as THREE from 'three';

let _disc = null;
export function getDisc() {
  if (_disc) return _disc;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _disc = new THREE.CanvasTexture(c);
  return _disc;
}

// A set of small lights rendered as constant-size points with per-light colour.
export class LightSet {
  constructor(count, size = 7, opacity = 1) {
    this.n = 0;
    this.max = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    const mat = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, map: getDisc(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.name = 'lights/set';
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('gl_PointSize = size;',
        'gl_PointSize = size * clamp(700.0 / max(-mvPosition.z, 1.0), 0.34, 1.5);');
    };
    mat.customProgramCacheKey = () => 'ctl-lights-v2';
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'lights/set';
    this.points.frustumCulled = false;
    this.mat = mat;
  }
  add(x, y, z, r, g, b) {
    if (this.n >= this.max) return -1;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    return i;
  }
  setColor(i, r, g, b) { this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.geo.attributes.color.needsUpdate = true; }
  setPos(i, x, y, z) { this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.geo.attributes.position.needsUpdate = true; }
  finish() { this.geo.setDrawRange(0, this.n); this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; }
}
