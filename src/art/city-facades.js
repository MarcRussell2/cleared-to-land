// CITY FACADES - shader text used only by city-look's scene-owned solids material.
// Receives the prim's local metres, integer seed, dimensions, facade style and lit
// fraction in the enclosing shader. Returns surface colour, gloss and emission;
// never moves geometry or changes collision coverage. All colours are linear.
// Fine stains and roof equipment are painted relief, not projecting solids.
// The build-time quality constant removes costly weathering on phone tiers.
// Window hashes use integer cells and small modulo arguments in city-look.
// Receives ctDetail (0 low, 1 medium, 2 high): low omits roof/AC relief,
// medium omits fine stains. All tiers retain two blended window super-cell
// levels, anchored to the facade. Typical distant red-channel mean is 0.0144
// (lit fraction 0.4); points peak at 0.36, close windows at 0.28, LED rings
// at 0.12. These linear radiances account for the engine's night exposure.
export const CITY_FACADES = /* glsl */ `
    bool flats = style == 6.0;
    float fh = flats ? 2.8 : 3.6;
    float bw = flats ? 2.4 : style == 10.0 ? 1.25 : 1.8;
    // Position, rather than the interpolated normal, gives cylindrical bays a
    // continuous physical width, including on the coarser phone geometry.
    float s = style == 10.0 ? atan(p.z - ctSize.z * 0.5, p.x - ctSize.x * 0.5) * ctSize.x
      : abs(n.x) > 0.5 ? p.z : p.x;
    vec2 cell = vec2(s / bw, p.y / fh), f = fract(cell), id = floor(cell);
    vec2 fw = max(fwidth(cell), vec2(0.001));
    float aa = 1.0 - smoothstep(0.18, 1.1, max(fw.x, fw.y));
    float bay = smoothstep(0.04, 0.04 + fw.x, f.x) * (1.0 - smoothstep(0.96 - fw.x, 0.96, f.x));
    float pane = smoothstep(flats ? 0.22 : 0.07, (flats ? 0.22 : 0.07) + fw.x, f.x)
      * (1.0 - smoothstep((flats ? 0.78 : 0.94) - fw.x, flats ? 0.78 : 0.94, f.x))
      * smoothstep(flats ? 0.43 : 0.26, (flats ? 0.43 : 0.26) + fw.y, f.y)
      * (1.0 - smoothstep(0.9 - fw.y, 0.9, f.y));
    float variation = ctCellHash(id, seedI, 0.0);
    float floorPick = ctCellHash(vec2(0.0, id.y), seedI, 11.0);
    vec3 wall = diffuseColor.rgb;
    vec3 glass = mix(wall * 0.34, vec3(0.105, 0.17, 0.205), 0.55) * (0.86 + 0.22 * variation);
    if (side) {
      if (flats) {
        wall *= 0.82 + 0.28 * ctCellHash(vec2(0.0), seedI, 18.0);
        if (ctDetail > 1.5) {
          float stain = ctNoise(vec2(s * 0.32, p.y * 0.025) + mod(seedI, 31.0));
          wall *= 0.76 + 0.24 * stain;
          wall *= 1.0 - 0.16 * exp(-max(ctSize.y - p.y, 0.0) / 3.0);
        }
        // Painted slab edges, recessed balcony shadows and individual AC units.
        float slab = (1.0 - smoothstep(0.04, 0.1, f.y)) * aa;
        wall *= 1.0 - 0.25 * slab;
        if (ctDetail > 0.5) {
          float ac = step(0.69, f.x) * step(f.x, 0.91) * step(0.23, f.y) * step(f.y, 0.39) * aa;
          wall = mix(wall, vec3(0.29, 0.285, 0.26) * (0.7 + 0.3 * step(0.27, f.y)), ac);
        }
        diffuseColor.rgb = mix(wall, vec3(0.025, 0.038, 0.043), pane * aa);
        if (p.y < 3.0) {
          float sign = step(1.8, p.y) * step(p.y, 2.5) * bay * aa;
          vec3 paint = mix(vec3(0.15, 0.055, 0.035), vec3(0.065, 0.14, 0.12), step(0.5, variation));
          diffuseColor.rgb = mix(wall * 0.32, paint, sign);
        }
        ctGloss = 0.35 * pane * aa;
      } else {
        // Fritted glass between floors; each frame fades at its OWN pixel width.
        float spandrel = 1.0 - smoothstep(0.2, 0.25 + fw.y, f.y);
        diffuseColor.rgb = glass * (1.0 - (style == 10.0 ? 0.10 : 0.18) * spandrel * aa);
        float lineWidth = (style == 10.0 ? 0.035 : 0.07) / bw;
        float mullion = (1.0 - smoothstep(lineWidth * 0.5, lineWidth * 0.5 + fw.x,
          min(f.x, 1.0 - f.x))) * (1.0 - smoothstep(0.5, 1.5, fw.x / lineWidth));
        float floorLine = (1.0 - smoothstep(0.025 / fh, 0.025 / fh + fw.y, min(f.y, 1.0 - f.y)))
          * (1.0 - smoothstep(0.5, 1.5, fw.y / (0.05 / fh)));
        diffuseColor.rgb *= 1.0 - 0.3 * max(mullion, floorLine);
        ctGloss = 0.82 - 0.12 * mullion;
      }
      // Dark floors, curtains, dim rooms and occasional cool fluorescent offices.
      float occupied = step(1.0 - litFrac, ctCellHash(id, seedI, 1.0)) * step(flats ? 0.08 : 0.22, floorPick);
      float level = mix(0.035, 0.28, variation * variation);
      vec3 lamp = mix(vec3(1.0, 0.72, 0.43), vec3(0.68, 0.82, 1.0),
        step(flats ? 0.87 : 0.72, floorPick));
      // Two adjacent power-of-two levels retain stationary sparse points once
      // individual windows fall below two pixels. No screen-space/random phase.
      float footprint = max(fw.x, fw.y);
      float lod = max(0.0, log2(max(1.0, footprint * 4.0)));
      float scale = exp2(floor(lod));
      float probability = clamp(litFrac * 0.625, 0.0, 0.35);
      float points = mix(ctWindowPoints(cell, fw, scale, seedI, probability),
        ctWindowPoints(cell, fw, scale * 2.0, seedI, probability), smoothstep(0.0, 1.0, fract(lod)));
      vec3 distantLamp = vec3(1.0, 0.75, 0.49) * 0.36 * points;
      ctEmit = ctNight * mix(lamp * level * occupied * pane,
        distantLamp, smoothstep(0.2, 0.5, footprint));
      if (!flats) {
        float crown = smoothstep(ctSize.y - 5.0, ctSize.y - 3.5, p.y)
          * (1.0 - smoothstep(ctSize.y - 1.0, ctSize.y, p.y));
        float ringDistance = abs(mod(p.y + 18.0, 36.0) - 18.0);
        float ringFootprint = max(fwidth(p.y), 0.001);
        float band = style == 10.0 ? clamp((0.5 - ringDistance) / ringFootprint + 0.5, 0.0, 1.0)
          * min(1.0, 1.0 / ringFootprint) : 0.0;
        diffuseColor.rgb = mix(diffuseColor.rgb, wall * 0.68, crown * 0.6);
        ctEmit += vec3(0.7, 0.8, 0.9) * ctNight * (0.025 * crown + 0.12 * band);
      }
    } else if (n.y > 0.5) {
      // Roof membrane, parapet and painted plant rooms/tanks. All stay on the
      // original roof plane: the roof's collision height remains unambiguous.
      vec2 uv = p.xz / max(ctSize.xz, vec2(1.0));
      float rim = step(0.035, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
      diffuseColor.rgb = wall * mix(0.84, 0.39, rim);
      if (ctDetail > 0.5) {
        // Zero to four items per roof, with independent centres and metre sizes.
        // Signed masks paint a shadow edge and top; no geometry leaves the roof.
        float bare = step(0.22, ctCellHash(vec2(0.0), seedI, 23.0));
        vec2 roofFW = max(fwidth(p.xz), vec2(0.01));
        for (int item = 0; item < 4; item++) {
          if (ctDetail < 1.5 && item > 1) break;
          float k = float(item);
          float pick = ctCellHash(vec2(k, 0.0), seedI, 24.0);
          vec2 centre = mix(vec2(0.22), vec2(0.78), vec2(pick, ctCellHash(vec2(k, 1.0), seedI, 25.0)));
          if (item == 0) centre = mix(vec2(0.4), vec2(0.6), centre);
          vec2 halfSize = min(ctSize.xz * 0.09, vec2(1.0 + 2.4 * pick, 0.8 + 1.6 * ctCellHash(vec2(k, 2.0), seedI, 26.0)));
          vec2 delta = p.xz - centre * ctSize.xz;
          float width = max(roofFW.x, roofFW.y);
          float shape = item == 2 ? length(delta) - min(halfSize.x, halfSize.y)
            : max(abs(delta.x) - halfSize.x, abs(delta.y) - halfSize.y);
          float mask = 1.0 - smoothstep(-width * 0.5, width * 0.5, shape);
          vec2 shadowDelta = delta - vec2(0.55, -0.55);
          float shadowShape = item == 2 ? length(shadowDelta) - min(halfSize.x, halfSize.y)
            : max(abs(shadowDelta.x) - halfSize.x, abs(shadowDelta.y) - halfSize.y);
          float shadow = 1.0 - smoothstep(-width * 0.5, width * 0.5, shadowShape);
          float present = bare * step(k * 0.2, pick) * rim;
          diffuseColor.rgb *= 1.0 - 0.48 * shadow * present;
          float highlight = clamp(0.5 + (delta.y - delta.x) / max(halfSize.x + halfSize.y, 0.1), 0.0, 1.0);
          vec3 top = wall * (item == 0 ? 0.25 : item == 2 ? 0.22 + 0.25 * highlight : 0.42 + 0.16 * highlight);
          diffuseColor.rgb = mix(diffuseColor.rgb, top, mask * present);
        }
      }
    }
`;
