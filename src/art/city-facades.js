// CITY FACADES - shader text used only by city-look's scene-owned solids material.
// Receives the prim's local metres, integer seed, dimensions, facade style and lit
// fraction in the enclosing shader. Returns surface colour, gloss and emission;
// never moves geometry or changes collision coverage. All colours are linear.
// Fine stains and roof equipment are painted relief, not projecting solids.
// The build-time quality constant removes costly weathering on phone tiers.
// Window hashes use integer cells and small modulo arguments in city-look.
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
        // Glass fills most of the elevation; narrow mullions and opaque spandrels
        // replace the old dark-square grid. Their average is quiet at distance.
        float spandrel = 1.0 - smoothstep(0.2, 0.25 + fw.y, f.y);
        diffuseColor.rgb = mix(glass, wall * 0.43, spandrel * aa);
        diffuseColor.rgb = mix(wall * 0.9, diffuseColor.rgb, mix(1.0, bay, aa));
        ctGloss = mix(0.75, pane, aa);
      }
      // Dark floors, curtains, dim rooms and occasional cool fluorescent offices.
      float occupied = step(1.0 - litFrac, ctCellHash(id, seedI, 1.0)) * step(flats ? 0.08 : 0.22, floorPick);
      float level = mix(0.035, 0.28, variation * variation);
      vec3 lamp = mix(vec3(1.0, 0.72, 0.43), vec3(0.68, 0.82, 1.0),
        step(flats ? 0.87 : 0.72, floorPick));
      // No average emission fallback: unresolved windows fade to darkness.
      ctEmit = lamp * ctNight * level * occupied * pane * aa * aa;
      if (!flats) {
        float crown = smoothstep(ctSize.y - 5.0, ctSize.y - 3.5, p.y)
          * (1.0 - smoothstep(ctSize.y - 1.0, ctSize.y, p.y));
        float band = style == 10.0 ? (1.0 - smoothstep(0.06, 0.14, abs(fract(p.y / 36.0) - 0.5))) : 0.0;
        diffuseColor.rgb = mix(diffuseColor.rgb, wall * 0.68, crown * 0.6);
        ctEmit += vec3(0.7, 0.8, 0.9) * ctNight * (0.025 * crown + 0.012 * band);
      }
      diffuseColor.rgb *= mix(1.0, 0.24, ctNight);
    } else if (n.y > 0.5) {
      // Roof membrane, parapet and painted plant rooms/tanks. All stay on the
      // original roof plane: the roof's collision height remains unambiguous.
      vec2 uv = p.xz / max(ctSize.xz, vec2(1.0));
      float rim = step(0.035, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
      diffuseColor.rgb = wall * mix(0.84, 0.39, rim);
      if (ctDetail > 0.5) {
        vec2 roofCell = p.xz / 7.0, rf = fract(roofCell);
        float equipment = step(0.48, ctCellHash(floor(roofCell), seedI, 23.0));
        float room = step(0.15, rf.x) * step(rf.x, 0.64) * step(0.2, rf.y) * step(rf.y, 0.7);
        float tank = 1.0 - smoothstep(0.14, 0.19, length(rf - vec2(0.73, 0.68)));
        float roofAA = 1.0 - smoothstep(0.1, 0.5, max(fwidth(roofCell.x), fwidth(roofCell.y)));
        diffuseColor.rgb = mix(diffuseColor.rgb, wall * (0.68 + 0.15 * rf.y), max(room, tank) * equipment * rim * roofAA);
      }
      diffuseColor.rgb *= mix(1.0, 0.3, ctNight);
    }
`;
