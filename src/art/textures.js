// Every procedural texture the world is painted with.
//
// Nothing here is loaded from a file: each one is drawn into a canvas at build
// time and uploaded as a THREE.CanvasTexture. That keeps the game a single HTML
// file, keeps it deterministic, and lets a texture be authored as code.
//
// CTL pass 5b: paved sheets are 2048 x 256 RGBA (2,097,152 bytes before
// mipmaps); loose strips retain 2048 x 512. Marking coordinates are unchanged.
// Rules for anything added here:
//   - draw deterministically (use noise2/fbm2/makeRng from config.js)
//   - set colorSpace = SRGBColorSpace on anything that carries colour
//   - keep the canvas sizes below to what they are or smaller; the whole game is
//     one file and every texture here is built on the main thread at load
import * as THREE from 'three';
import { clamp, noise2, makeRng } from '../config.js';
import { PALETTE } from './palette.js';

// Periodic 1024 px scalar ground detail: clumps, exposed soil, stones and tufts.
// Neutral mid-grey data (not sRGB colour); world-ground supplies site tint and
// samples at 8 / 90 metres. Every mark wraps, including its shadow and highlight.
export function groundDetail(seed) {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), rng = makeRng(seed + 17);
  g.fillStyle = PALETTE.groundDetail.base;
  g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S), d = img.data;
  // Small periodic noise lattice avoids millions of noise evaluations at load.
  const N = 32, lattice = Float32Array.from({length:N*N}, () => rng());
  for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
    const u=x/32,v=y/32, ix=Math.floor(u),iy=Math.floor(v);
    const fx=u-ix,fy=v-iy, sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
    const at=(a,b)=>lattice[(b%N)*N+a%N];
    const n=(1-sy)*((1-sx)*at(ix,iy)+sx*at(ix+1,iy))
      +sy*((1-sx)*at(ix,iy+1)+sx*at(ix+1,iy+1));
    const value=128+(n-0.5)*36+(rng()-0.5)*16, i=(y*S+x)*4;
    d[i]=d[i+1]=d[i+2]=value; d[i+3]=255;
  }
  g.putImageData(img,0,0);
  const dot=(x,y,r,colour)=>{
    g.fillStyle=colour;
    for(let dy=-S;dy<=S;dy+=S) for(let dx=-S;dx<=S;dx+=S) {
      if(x+dx+r<0||x+dx-r>S||y+dy+r<0||y+dy-r>S) continue;
      g.beginPath();g.ellipse(x+dx,y+dy,r,r*0.65,0,0,Math.PI*2);g.fill();
    }
  };
  for(let i=0;i<900;i++) dot(rng()*S,rng()*S,3+rng()*16,'rgba(148,148,148,0.18)');
  for(let i=0;i<14000;i++) {
    const x=rng()*S,y=rng()*S,r=0.6+rng()*2.2;
    dot(x+1,y+1,r*1.25,PALETTE.groundDetail.blades);
    dot(x,y,r, i%5===0 ? PALETTE.groundDetail.highlights : 'rgba(155,155,155,0.25)');
  }
  // Short clustered blades, with periodic copies at the tile boundary.
  g.lineWidth=0.8;
  for(let i=0;i<3200;i++) {
    const x=rng()*S,y=rng()*S,len=2+rng()*5;
    for(let dy=-S;dy<=S;dy+=S) for(let dx=-S;dx<=S;dx+=S) {
      if(x+dx+8<0||x+dx-8>S||y+dy+8<0||y+dy-8>S)continue;
      g.strokeStyle=PALETTE.groundDetail.blades;
      g.beginPath();
      for(let blade=-1;blade<=1;blade++) {
        g.moveTo(x+dx,y+dy);g.lineTo(x+dx+blade*2,y+dy-len+Math.abs(blade));
      }
      g.stroke();
      g.strokeStyle=PALETTE.groundDetail.highlights;
      g.beginPath();g.moveTo(x+dx+0.7,y+dy-1);g.lineTo(x+dx+0.7,y+dy-len);g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// The runway, painted end to end: surface, skid marks, and every marking.
//
// `rw` is a resolved runway (world/airport.js): length, width, surface
// ('asphalt' | 'gravel' | 'sand' | anything else = dirt), name, nameRecip and
// aimDistance. The texture maps 1:1 onto the runway quad, so u runs along the
// runway from the threshold and v across it.
//
// The marking geometry is aeronautical fact, not taste: threshold bars, the
// aiming point at aimDistance, the touchdown-zone ladder, the runway numbers.
// Their look is yours; their meaning is not.
export function runwaySurface(rw) {
  const W = 2048, H = rw.surface === 'asphalt' ? 256 : 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const L = rw.length, Wd = rw.width;
  const sx = W / L, sy = H / Wd;
  const P = PALETTE.runway;
  const asphalt = rw.surface === 'asphalt';
  g.fillStyle = asphalt ? P.asphalt : rw.surface === 'gravel' ? P.gravel : rw.surface === 'sand' ? P.sand : P.dirt;
  g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const n = noise2(x / 23.7, y / 23.7, 7) * 14 + noise2(x / 3.1, y / 3.1, 9) * 10;
      for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) {
        const i = ((y + j) * W + (x + k)) * 4;
        d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n, 0, 255);
      }
    }
  }
  g.putImageData(img, 0, 0);
  // Build-time wear in metres, before paint so markings remain legible.
  const wear=makeRng(Math.round(L)*31+Math.round(Wd)*7+83);
  const crown=g.createLinearGradient(0,0,0,H);
  crown.addColorStop(0,'rgba(64,58,41,0.28)');
  crown.addColorStop(0.16,'rgba(0,0,0,0.04)');
  crown.addColorStop(0.5,asphalt?'rgba(210,208,193,0.10)':'rgba(220,210,171,0.22)');
  crown.addColorStop(0.84,'rgba(0,0,0,0.04)');
  crown.addColorStop(1,'rgba(64,58,41,0.28)');
  g.fillStyle=crown; g.fillRect(0,0,W,H);
  if(asphalt) {
    for(let i=0;i<85;i++) {
      const x=wear()*W,y=wear()*H,w=(3+wear()*22)*sx,h=(0.8+wear()*5)*sy;
      g.fillStyle=wear()<0.5?'rgba(22,25,28,0.19)':'rgba(155,150,139,0.13)';
      g.fillRect(x,y,w,h);
      g.strokeStyle='rgba(28,27,25,0.24)';g.lineWidth=0.15*sy;
      g.strokeRect(x,y,w,h);
    }
    for(let i=0;i<65;i++) {
      let x=wear()*W,y=wear()*H;
      g.beginPath();g.moveTo(x,y);
      for(let j=0;j<5;j++){x+=(wear()-0.35)*7*sx;y+=(wear()-0.5)*2*sy;g.lineTo(x,y);}
      g.strokeStyle='rgba(15,17,18,0.27)';g.lineWidth=0.10*sy;g.stroke();
    }
  } else {
    // Stone clusters for gravel, softer clods for dirt; physically sized so
    // the short gravel bar gets appreciably more detail than a long runway.
    for(let i=0;i<16000;i++) {
      const x=wear()*W,y=wear()*H,r=0.06+wear()*(rw.surface==='gravel'?0.28:0.55);
      g.fillStyle=wear()<0.48?'rgba(43,40,34,0.24)':'rgba(223,216,192,0.32)';
      g.fillRect(x,y,Math.max(1,r*sx),Math.max(1,r*sy));
    }
    for(const side of [-1,1]) for(let lane=0;lane<3;lane++) {
      g.beginPath();
      for(let x=0;x<=W;x+=8) {
        const v=Wd/2+side*(1.6+lane*0.24)+noise2(x/170,side,91)*0.30;
        if(x===0)g.moveTo(x,v*sy);else g.lineTo(x,v*sy);
      }
      g.strokeStyle=rw.surface==='gravel'?'rgba(57,52,43,0.16)':'rgba(40,31,20,0.25)';
      g.lineWidth=(lane===0?0.42:0.16)*sy;g.stroke();
    }
  }
  if (asphalt) {
    // Seeded from the runway itself: the same runway is scuffed the same way every
    // time, so two screenshots of one scene can be compared pixel for pixel.
    const rng = makeRng(Math.round(L) * 31 + Math.round(Wd) * 7 + 11);
    g.fillStyle = P.rubber;
    for (let i = 0; i < 260; i++) {
      const u = 150 + Math.abs(noise2(i * 0.7, 3, 4)) * 700 + rng() * 350;
      const v = Wd / 2 + (rng() < 0.5 ? -1 : 1) * (3 + rng() * 6);
      g.fillRect(u * sx, v * sy - 1, (10 + rng() * 40) * sx, 3);
    }
    g.fillStyle = P.joints;
    for (let u = 0; u < L; u += 25) g.fillRect(u * sx, 0, Math.max(0.3, 0.22 * sx), H);
    const white = P.markings;
    g.fillStyle = white;
    g.fillRect(0, 0, W, 0.9 * sy);
    g.fillRect(0, H - 0.9 * sy, W, 0.9 * sy);
    const stripes = Math.max(4, Math.min(16, Math.round(Wd / 3.75)));
    const stripeW = 1.8, gap = (Wd - 2 * 1.5 - stripes * stripeW) / (stripes - 1);
    for (let end = 0; end < 2; end++) {
      const u0 = end === 0 ? 6 : L - 36;
      for (let i = 0; i < stripes; i++) {
        const v = 1.5 + i * (stripeW + gap);
        g.fillRect(u0 * sx, v * sy, 30 * sx, stripeW * sy);
      }
    }
    for (let u = 60; u < L - 60; u += 50) g.fillRect(u * sx, (Wd / 2 - 0.45) * sy, 30 * sx, 0.9 * sy);
    const aim = rw.aimDistance || Math.min(400, L * 0.15);
    const barLen = L > 1500 ? 50 : 30, barW = L > 1500 ? 8 : 4;
    for (const side of [-1, 1]) {
      g.fillRect(aim * sx, (Wd / 2 + side * (barW / 2 + 5) - barW / 2) * sy, barLen * sx, barW * sy);
      g.fillRect((L - aim - barLen) * sx, (Wd / 2 + side * (barW / 2 + 5) - barW / 2) * sy, barLen * sx, barW * sy);
    }
    if (L > 1500) {
      for (const dist of [150, 450, 600, 750, 900]) {
        for (const side of [-1, 1]) {
          const nb = dist <= 150 ? 3 : dist <= 600 ? 2 : 1;
          for (let k = 0; k < nb; k++) {
            const v = Wd / 2 + side * (6 + k * 2.6) - 0.9;
            g.fillRect(dist * sx, v * sy, 22 * sx, 1.8 * sy);
            g.fillRect((L - dist - 22) * sx, v * sy, 22 * sx, 1.8 * sy);
          }
        }
      }
    }
    const drawNum = (txt, u, flip) => {
      g.save();
      g.translate(u * sx, (Wd / 2) * sy);
      g.rotate(flip ? Math.PI / 2 : -Math.PI / 2);
      g.font = `bold ${Math.round(Wd * 0.62 * sy)}px "Arial Narrow", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = white;
      g.fillText(txt, 0, 0);
      g.restore();
    };
    drawNum(rw.name, 55, true);
    drawNum(rw.nameRecip, L - 55, false);
  } else {
    // The wandering wheel tracks were baked with the loose surface above.
    g.fillStyle = P.bushEdge;
    for (let u = 0; u < L; u += 60) { g.fillRect(u * sx, 0.5 * sy, 6 * sx, 0.6 * sy); g.fillRect(u * sx, (Wd - 1.1) * sy, 6 * sx, 0.6 * sy); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// The flight deck, painted in ship-local coordinates.
//
// `spec` comes from world/carrier.js and is read-only:
//   { len, wid, ramp, dir, right, halfWidth, wires, hullNumber }
// where ramp/dir/right are {x, z} in ship-local metres (x right, z aft-positive,
// bow at z = -len/2) and wires are distances up the landing area from the ramp.
// The wires and the landing-area width are simulation facts; paint them where
// they are.
export function carrierDeck(spec) {
  const W = 1024, H = 4096;
  const { len: LEN, wid: WID } = spec;
  const P = PALETTE.deck;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const px = (x) => ((x + WID / 2) / WID) * W;
  const py = (z) => ((LEN / 2 - z) / LEN) * H;
  g.fillStyle = P.base;
  g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const n = noise2(x / 9, y / 9, 11) * 9;
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) { const i = ((y + j) * W + x + k) * 4; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  }
  g.putImageData(img, 0, 0);
  // World pass 6: non-skid grain, the tie-down grid, rubber in the landing area,
  // stains around the elevators, elevator outlines, catapult tracks with their
  // JBD hinge lines, a no-step band at the round-down. Seeded from the hull number.
  const wear = makeRng(parseInt(spec.hullNumber, 10) * 131 + 7);
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let z = -LEN / 2 + 3; z < LEN / 2; z += 1.25) {
    const row = Math.round((z + LEN / 2) / 1.25) % 2;
    for (let x = -WID / 2 + 1 + row * 0.62; x < WID / 2; x += 1.25) {
      const px0 = px(x), py0 = py(z);
      g.fillRect(px0 - 1, py0 - 1, 3, 3);
    }
  }
  for (let i = 0; i < 900; i++) {
    const x = (wear() - 0.5) * WID, z = (wear() - 0.5) * LEN;
    g.fillStyle = wear() < 0.5 ? 'rgba(30,32,34,0.16)' : 'rgba(120,124,128,0.12)';
    g.fillRect(px(x), py(z), 2 + wear() * 6, 1 + wear() * 3);
  }
  g.fillStyle = 'rgba(60,44,30,0.22)';
  for (const [ex, ez] of [[30, -55], [30, 40], [30, 110], [-30, 110]]) {
    for (let i = 0; i < 40; i++) g.fillRect(px(ex + (wear() - 0.5) * 20), py(ez + (wear() - 0.5) * 24), 3 + wear() * 10, 2 + wear() * 5);
  }
  const r = spec.ramp, dd = spec.dir, rr = spec.right;
  const pt = (u, v) => [r.x + dd.x * u + rr.x * v, r.z + dd.z * u + rr.z * v];
  const line = (u0, v0, u1, v1, w, color, dash) => {
    const a = pt(u0, v0), b = pt(u1, v1);
    g.strokeStyle = color; g.lineWidth = w;
    g.setLineDash(dash || []);
    g.beginPath(); g.moveTo(px(a[0]), py(a[1])); g.lineTo(px(b[0]), py(b[1])); g.stroke();
    g.setLineDash([]);
  };
  const wpx = (m) => (m / WID) * W;
  const halfW = spec.halfWidth;
  line(-5, -halfW, 245, -halfW, wpx(0.5), P.lines);
  line(-5, halfW, 245, halfW, wpx(0.5), P.lines);
  line(-5, -halfW - 4, 245, -halfW - 4, wpx(0.5), P.foul, [30, 30]);
  line(-5, halfW + 4, 245, halfW + 4, wpx(0.5), P.foul, [30, 30]);
  line(0, 0, 245, 0, wpx(0.6), P.lines, [wpx(6), wpx(6)]);
  for (let i = 0; i < spec.wires.length; i++) line(spec.wires[i], -halfW + 2, spec.wires[i], halfW - 2, wpx(0.25), P.wire);
  g.save();
  g.translate(px(0), py(-120));
  g.font = `bold ${wpx(24)}px Arial`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = P.hullNumber;
  g.fillText(spec.hullNumber, 0, 0);
  g.restore();
  g.fillStyle = P.catapult;
  g.fillRect(px(-8) - 3, py(-55), 6, py(-160) - py(-55));
  g.fillRect(px(8) - 3, py(-55), 6, py(-160) - py(-55));
  g.strokeStyle = P.elevator; g.lineWidth = 3;
  for (const [ex, z0, z1] of [[22, -72, -40], [22, 20, -5], [22, 100, 75], [-38, 120, 96]]) {
    g.strokeRect(px(ex), py(z0), wpx(16), py(z1) - py(z0));
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(px(ex) - 1, py(z0), 3, py(z1) - py(z0));
  }
  // Rubber where the wheels meet the deck: between the ramp and the 3-wire, streaked.
  g.fillStyle = 'rgba(14,14,16,0.30)';
  for (let i = 0; i < 180; i++) {
    const u = spec.wires[0] - 16 + wear() * (spec.wires[3] - spec.wires[0] + 40), v = (wear() - 0.5) * 2 * (halfW - 1);
    const a = pt(u, v), b = pt(u + 4 + wear() * 12, v + (wear() - 0.5) * 0.6);
    g.strokeStyle = 'rgba(14,14,16,0.28)'; g.lineWidth = wpx(0.35 + wear() * 0.4);
    g.beginPath(); g.moveTo(px(a[0]), py(a[1])); g.lineTo(px(b[0]), py(b[1])); g.stroke();
  }
  // Catapult tracks (two on the bow, two on the waist) with their JBD hinge lines.
  g.fillStyle = P.catapult;
  for (const [cx, z0, z1] of [[-8, -160, -55], [8, -160, -55], [-22, -30, 60], [-30, -25, 65]]) {
    g.fillRect(px(cx) - 3, py(z0), 6, py(z1) - py(z0));
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px(cx) - wpx(4), py(z1) - 2, wpx(8), 4); g.fillStyle = P.catapult;
  }
  // No-step band at the round-down.
  g.fillStyle = 'rgba(200,60,50,0.55)';
  const rd0 = pt(-3, -halfW - 8), rd1 = pt(-3, halfW + 8);
  g.lineWidth = wpx(1.2); g.strokeStyle = 'rgba(210,70,55,0.6)';
  g.beginPath(); g.moveTo(px(rd0[0]), py(rd0[1])); g.lineTo(px(rd1[0]), py(rd1[1])); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

// ---------------------------------------------------------------- the new maps (2026-09-17)
// An ice runway ploughed on a frozen lake ('ice'), or a runway of packed snow ('snow'): painted like
// runwaySurface (2048 x 512, u along the runway, v across it, mapped 1:1 onto the quad), in the
// colours of BIOMES.runway. Ice: grey-blue, streaked with blown snow along the wind, cracked, the
// wheel tracks polished darker, the plough's banks white at both edges. Snow: packed white with
// grey-blue ruts. No paint: an ice strip is marked by the cones down its edges.
import { BIOMES } from './palette.js';

export function frozenRunwaySurface(rw) {
  const W = 2048, H = 512, L = rw.length, Wd = rw.width, sx = W / L, sy = H / Wd;
  const ice = rw.surface === 'ice';
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const B = BIOMES.runway;
  g.fillStyle = ice ? B.ice : B.snow;
  g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const n = noise2(x / 31, y / 31, 17) * (ice ? 10 : 6) + noise2(x / 4.1, y / 4.1, 19) * (ice ? 5 : 7);
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) {
      const i = ((y + j) * W + (x + k)) * 4;
      d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n * 1.1, 0, 255);
    }
  }
  g.putImageData(img, 0, 0);
  const rng = makeRng(Math.round(L) * 17 + Math.round(Wd) * 5 + (ice ? 3 : 4));
  // blown snow in long wisps, a few degrees off the runway's axis
  for (let i = 0; i < (ice ? 700 : 220); i++) {
    const x = rng() * W, y = rng() * H, len = (6 + rng() * 40) * sx, wid = (0.2 + rng() * 1.1) * sy;
    g.save(); g.translate(x, y); g.rotate(Math.atan(Math.tan(-0.03 + (rng() - 0.5) * 0.02) * sy / sx));
    g.fillStyle = ice ? `rgba(232,238,242,${0.10 + rng() * 0.25})` : `rgba(250,252,255,${0.2 + rng() * 0.3})`;
    g.beginPath(); g.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  // the wheel tracks: polished dark on ice, grey-blue ruts in snow
  for (const side of [-1, 1]) for (let lane = 0; lane < 2; lane++) {
    g.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const v = Wd / 2 + side * (1.4 + lane * 0.5) + noise2(x / 190, side + lane * 3, 23) * 0.35;
      if (x === 0) g.moveTo(x, v * sy); else g.lineTo(x, v * sy);
    }
    g.strokeStyle = ice ? 'rgba(40,58,70,0.22)' : 'rgba(120,140,160,0.30)';
    g.lineWidth = (lane ? 0.35 : 0.55) * sy; g.stroke();
  }
  if (ice) {
    // cracks: short jagged dark lines with a pale rim
    for (let i = 0; i < 90; i++) {
      let x = rng() * W, y = rng() * H;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (rng() - 0.5) * 9 * sx; y += (rng() - 0.5) * 3 * sy; g.lineTo(x, y); }
      g.strokeStyle = 'rgba(20,32,40,0.35)'; g.lineWidth = 0.05 * sy; g.stroke();
      g.strokeStyle = 'rgba(235,242,246,0.25)'; g.lineWidth = 0.12 * sy; g.stroke();
    }
  }
  // the plough's banks: white at both edges, ragged on the inside
  g.fillStyle = B.bank;
  for (const side of [0, 1]) {
    g.beginPath();
    for (let x = 0; x <= W; x += 6) {
      const w = (1.0 + 0.45 * noise2(x / 60, side * 7, 29) + 0.2 * noise2(x / 9, side * 7, 31)) * sy;
      const y = side ? H - w : w;
      if (x === 0) g.moveTo(x, side ? H : 0);
      g.lineTo(x, y);
    }
    g.lineTo(W, side ? H : 0); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
