// The quality tier, as the art bench sees it.
//
// src/main.js picks a rendering tier (low / medium / high; phones start a tier
// down and a frame-rate watchdog can step it further) and passes the knobs it
// always did: `shadowSize` to the SkySystem, `treeScale` to the forest, and the
// post-processing composer on or off. The world's look needs one word for all of
// that - how much geometry and shader work to spend - and this is where it lives.
//
//   WORLD_QUALITY.detail     'low' | 'medium' | 'high'
//   WORLD_QUALITY.shadowSize the shadow map size the tier asked for
//   WORLD_QUALITY.treeScale  the tier's forest thinning, 0..1
//
// It is set once per site, before the world is built: the SkySystem is the first
// thing src/main.js constructs for a site, and its constructor calls
// setWorldQuality() with the options it was handed. When the engine passes an
// explicit `detail` that wins; otherwise the tier is read off the shadow map size,
// which is the one knob every tier sets differently (4096 high, 2048 medium or a
// phone on high, 1024 low). Everything built afterwards - ground, forests, props,
// aerodrome, ship - reads WORLD_QUALITY.detail and sizes itself accordingly.
//
// Budgets per tier for a whole site, measured with tools/world-probe.mjs (draw calls
// and triangles of the scene alone, shadow pass included):
//   high    <= 250 calls, <= 1.5 M triangles     desktop with a real GPU, 60 fps at 1080p
//   medium  <= 180 calls, <= 0.8 M triangles     laptops, phones on "high"
//   low     <= 120 calls, <= 0.35 M triangles    no shadows, no composer
export const DETAIL_LEVELS = ['low', 'medium', 'high'];

export const WORLD_QUALITY = { detail: 'high', shadowSize: 4096, treeScale: 1 };

export function detailFromShadowSize(shadowSize) {
  const n = +shadowSize || 4096;
  return n >= 4096 ? 'high' : n >= 2048 ? 'medium' : 'low';
}

// 0 for low, 1 for medium, 2 for high: handy for lerping counts and distances.
export function detailIndex(detail = WORLD_QUALITY.detail) {
  const i = DETAIL_LEVELS.indexOf(detail);
  return i < 0 ? 2 : i;
}

export function setWorldQuality({ detail, shadowSize, treeScale } = {}) {
  if (shadowSize != null) WORLD_QUALITY.shadowSize = shadowSize;
  if (treeScale != null) WORLD_QUALITY.treeScale = treeScale;
  WORLD_QUALITY.detail = DETAIL_LEVELS.includes(detail) ? detail : detailFromShadowSize(WORLD_QUALITY.shadowSize);
  return WORLD_QUALITY;
}
