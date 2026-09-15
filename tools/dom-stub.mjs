// A stand-in `document` for the Node test suites, so the art modules that draw canvas
// textures (instrument faces, the light disc, the registration decal) can be BUILT in
// plain Node and their exports, part names and update() behaviour checked. Nothing is
// rasterised: the 2D context is a Proxy whose every method is a no-op that returns the
// proxy again (so `ctx.createLinearGradient(...).addColorStop(...)` chains), and reads
// of unknown properties return a no-op function too. measureText returns a width.
// Install before importing anything from src/art/ that touches a canvas.
export function installDomStub() {
  if (globalThis.document) return globalThis.document;
  const ctxProxy = new Proxy({}, {
    get(target, key) {
      if (key === 'canvas') return target.canvas;
      if (key === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (key === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h });
      if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h });
      if (key in target) return target[key];
      return () => ctxProxy;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const makeCanvas = () => {
    const c = { width: 300, height: 150, style: {}, getContext: () => ctxProxy, toDataURL: () => '', addEventListener() {}, removeEventListener() {} };
    return c;
  };
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } }),
    createElementNS: () => makeCanvas(),
    body: { appendChild() {} },
  };
  if (!globalThis.window) globalThis.window = globalThis;
  return globalThis.document;
}
