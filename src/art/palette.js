// The world's colour and finish book.
//
// Every colour the 3D world draws with lives here, named, in one place. The look
// modules next to this file read from it; nothing outside src/art/ does. Change a
// value here and the whole world moves with it — that is the point.
//
// Conventions:
//   0xRRGGBB        a THREE material colour
//   [r, g, b]       0..1 floats, for vertex colours and LightSet lights
//   '#rrggbb'       a canvas fill, for the procedural textures in textures.js
//   {h, s, l}       HSL, where the code varies a colour per instance
//
// FINISH holds the physically-based knobs (roughness / metalness) so a surface's
// colour and its finish are decided in the same place.

export const PALETTE = {
  atmosphere: {
    // Scattering defaults; runtime LUTs supply linear sky and transmitted sunlight.
    zenith: 0x397bc2,
    horizon: 0xb4c9df,
    warm: 0xffca8f,
    night: 0x18283d,
    fill: 0xbfd8ff,
    groundFill: 0x777b68,
    dayFill: 0xe8eff5,
    dayGroundFill: 0x777b68,
    moon: 0xc2d1e6,
    waterDeep: 0x083b46,
  },
  // ---------------------------------------------------------------- terrain
  ground: {
    // Linear reflectances, independent of sun exposure and texture brightness.
    crops: [[0.075,0.15,0.035],[0.10,0.18,0.045],[0.28,0.30,0.13],
      [0.16,0.13,0.085],[0.24,0.25,0.11],[0.065,0.125,0.03],[0.12,0.17,0.05]],
    sand: [0.34,0.30,0.21],
    wetSand: [0.15,0.14,0.105],
    submerged: [0.055,0.095,0.10],
    gravel: [0.28,0.275,0.25],
    scree: [0.25,0.245,0.215],
    snow: [0.85,0.87,0.89],
    alpineLow: [0.12,0.155,0.065],
    alpineHigh: [0.19,0.20,0.125],
    rock: [0.30,0.285,0.26],
    grass: [0.075,0.145,0.035],
    grassNoise: [0.018,0.025,0.012],
    pasture: [0.12,0.18,0.065],
    ploughed: [0.17,0.135,0.09],
    damp: [0.052,0.095,0.035],
    forestFloor: [0.065,0.09,0.035],
    mountainTint: [1,1,1],
    detailCompensation: 1,
  },

  // Neutral scalar detail; site tint is supplied to the ground shader.
  groundDetail: {
    base: '#808080',
    tint: [1,1,1],
    blades: 'rgba(42,42,42,0.28)',
    highlights: 'rgba(210,210,210,0.32)',
    plainsTint: [1,1,0.98],
    coastTint: [1.02,1,0.96],
    mountainTint: [0.98,1,1.02],
  },

  trees: {
    // Instanced forests vary per tree around these; see terrain-look.js buildForest().
    // HSL here is in three's linear working space: l = 0.07 is a dark spruce, not a
    // mid green (0.19 read as mint). Real crowns are dark: spruce about 0.03-0.05
    // linear green, broadleaf 0.08-0.14.
    conifer: { h: 0.36, hVary: 0.03, s: 0.40, l: 0.065, lVary: 0.03 },
    broadleaf: { h: 0.25, hVary: 0.06, s: 0.46, l: 0.115, lVary: 0.05 },
    obstacle: 0x2f5a2a,                // the big single trees on the bush approaches
    bark: 0x807566,
    treeline: 0x6f7a45,                // paler, yellower conifers just below the treeline
    hedge: 0x344c27,
    hedgeTop: 0x536d36,
    cardShade: '#aaaaaa',
    cardMid: '#d2d2d2',
    cardLight: '#ffffff',
    cardBark: '#807566',
  },

  rocks: 0x8a8580,
  road: 0x3f4247,
  village: {
    wall: { h: 0.08, hVary: 0.05, s: 0.15, sVary: 0.25, l: 0.70, lVary: 0.20 },
    roof: { h: 0.02, hVary: 0.06, s: 0.35, sVary: 0.30, l: 0.30, lVary: 0.15 },
  },

  // ---------------------------------------------------------------- airport
  runway: {
    // Canvas fills for the runway surface texture (textures.js runwaySurface).
    asphalt: '#4a4c4f',
    gravel: '#9a8f78',
    sand: '#c9b98c',
    dirt: '#7a6647',
    markings: '#e8e8e2',               // every painted marking on a paved runway
    bushEdge: '#e6e6e6',               // the little edge ticks on an unpaved strip
    rubber: 'rgba(20,20,22,0.35)',     // touchdown-zone skid marks
    joints: 'rgba(0,0,0,0.12)',        // slab joints every 25 m
    ruts: 'rgba(0,0,0,0.10)',          // wheel ruts on an unpaved strip
  },
  shoulder: 0x5b5d60,
  taxiLine: 0xd9b52a,

  buildings: {
    hangar: 0xb8bcc2,
    tHangar: 0x8d949c,
    roof: 0x6d7a86,
    glass: 0x2a4a66,
    fuelTank: 0xe8e8e8,
  },
  bushCamp: {
    cabin: 0x6b4a2e,
    roof: 0x3f3a35,
    drum: 0xc23b22,
  },
  windsock: {
    pole: 0xdddddd,
    sock: 0xff7a1a,
    band: 0xffffff,
  },
  marker: 0xffffff,                    // the cones down the edge of a bush strip
  papiBox: 0x222222,

  // Aerodrome lighting, as LightSet colours. These are aeronautical facts as much
  // as choices — green is a threshold, red is an end — so change the shade, not
  // the meaning.
  lights: {
    edge: [1, 1, 0.9],
    edgeCaution: [1, 0.7, 0.2],        // the last 600 m of a long runway
    threshold: [0.1, 1, 0.2],
    end: [1, 0.1, 0.1],
    centreline: [0.9, 0.9, 0.9],
    approach: [1, 1, 1],
    taxiway: [0.2, 0.3, 1],
    papiWhite: [1, 1, 1],
    papiRed: [1, 0.08, 0.05],
    strobe: [3, 3, 3],                 // over 1 on purpose: it blows out through the bloom
    off: [0, 0, 0],
    size: { runway: 6, papi: 9 },      // point size in pixels
    dayOpacity: 0.55,
    nightOpacity: 1,
  },

  // ---------------------------------------------------------------- carrier
  // Canvas fills for the flight-deck texture (textures.js carrierDeck).
  deck: {
    base: '#3c4044',
    lines: '#f0f0f0',                  // landing area edges and centreline
    foul: '#e04040',                   // the foul lines either side
    wire: '#141414',
    hullNumber: '#e8e8e8',
    catapult: '#2a2d30',
    elevator: '#b0b0b0',
  },
  carrier: {
    deckSide: 0x5a6068,
    hull: 0x4a5058,
    gallery: 0x464c54,
    island: 0x6b7178,
    dome: 0xdddddd,
    wire: 0x222222,
    lensBox: 0x333333,
    wake: 0xffffff,
    wakeOpacity: 0.35,
    // Deck and IFLOLS lighting, as LightSet colours. Like the aerodrome lights
    // the meanings are fixed - amber deck edges, a red drop line, green datums -
    // so move the shade, not the signal.
    deckCentreline: [1, 1, 1],
    deckEdge: [1, 0.9, 0.3],
    dropLine: [1, 0.3, 0.1],
    datum: [0.1, 1, 0.2],
    // The meatball itself: the lit cell, the low-and-slow red, and the dark cells.
    ball: [1, 0.7, 0.2],
    ballLow: [1, 0.1, 0.1],
    ballOff: [0.02, 0.02, 0.02],
    waveoff: [1, 0, 0],
    deckLightSize: 5,
    lensLightSize: 10,
    deckDayOpacity: 0.5,
    deckNightOpacity: 1,
  },
};

// Roughness / metalness per surface class. Everything the world draws should pick
// one of these rather than inventing numbers, so the whole scene stays consistent
// under a change of lighting.
export const FINISH = {
  ground:    { roughness: 0.95, metalness: 0.0 },
  runway:    { roughness: 0.92, metalness: 0.0 },
  shoulder:  { roughness: 0.95, metalness: 0.0 },
  paint:     { roughness: 0.80, metalness: 0.0 },
  foliage:   { roughness: 0.90, metalness: 0.0 },
  rock:      { roughness: 0.95, metalness: 0.0 },
  building:  { roughness: 0.80, metalness: 0.0 },
  houseWall: { roughness: 0.85, metalness: 0.0 },
  houseRoof: { roughness: 0.90, metalness: 0.0 },
  roof:      { roughness: 0.85, metalness: 0.0 },
  glass:     { roughness: 0.20, metalness: 0.5 },
  metal:     { roughness: 0.60, metalness: 0.0 },
  painted:   { roughness: 0.70, metalness: 0.0 },
  timber:    { roughness: 0.90, metalness: 0.0 },
  steel:     { roughness: 0.40, metalness: 0.6 },
  ship:      { roughness: 0.85, metalness: 0.0 },
  fabric:    { roughness: 0.90, metalness: 0.0 },
  deck:      { roughness: 0.90, metalness: 0.1 },
};

// ---------------------------------------------------------------- the new maps (2026-09-17)
// The missions expansion's three terrain styles (src/world/terrain.js 'island', 'desert', 'arctic') and
// their props, read by world-ground.js, world-biomes.js, world-water.js and textures.js. Same conventions
// as PALETTE above: linear [r, g, b] albedos, 0xRRGGBB material colours, '#rrggbb' canvas fills, and HSL
// parts where a colour varies per instance (in three's linear working space: l = 0.06 is a dark green).
// A separate export so the original book above is untouched.
export const BIOMES = {
  island: {
    sand: [0.60, 0.56, 0.45],          // coral sand: whiter than a temperate beach
    wetSand: [0.34, 0.32, 0.26],
    seabed: [0.42, 0.44, 0.36],
    lush: [0.046, 0.090, 0.026],       // the moist hollows and the lowland: greener, never lawn
    lushNoise: [0.010, 0.015, 0.006],
    scrub: [0.068, 0.076, 0.036],      // the island's base: dry olive-grey scrub (a Leeward island, not a jungle)
    dryGrass: [0.165, 0.145, 0.075],   // sun-burnt patches
    soil: [0.20, 0.115, 0.06],         // red-brown earth where the slopes erode
    woodFloor: [0.024, 0.036, 0.017],  // the dry forest's shade, which is what makes its stands read as masses
    rock: [0.25, 0.22, 0.18],
    // The water body over the shallows (world-water.js), multiplied by the daylight as the deep colour is:
    // sand seen through a metre of water, the turquoise over the shelf, the darker reef and weed patches.
    shallow: [0.25, 0.47, 0.42],
    lagoon: [0.028, 0.23, 0.25],
    reef: [0.018, 0.09, 0.10],
    palmTrunk: 0x7d705e,
    palmFrond: { h: 0.23, hVary: 0.04, s: 0.55, l: 0.075, lVary: 0.03 },
    palmDry: [0.20, 0.17, 0.08],        // the old fronds hanging lowest
    scrubTree: { h: 0.24, hVary: 0.05, s: 0.5, l: 0.068, lVary: 0.025 },
    umbrellas: [0xd9483b, 0x2f7fb8, 0xe8c547, 0xf2f0e8, 0x3c9a6e, 0xe07b39],
    pole: 0xd8d2c4,
    lounger: 0xe6e0d2,
    towel: 0x3a78b0,
    walls: { h: 0.10, hVary: 0.08, s: 0.30, sVary: 0.30, l: 0.62, lVary: 0.20 },   // pastel hotels and houses
    roof: 0xa8492d,                    // terracotta
    fence: 0x8c9196,
    sign: 0xd8c23a,
    cars: [0xb8bcc0, 0x2a2d31, 0xc0392b, 0xe8e8e6, 0x2c5f8a],
  },
  desert: {
    sand: [0.44, 0.23, 0.115],         // red sand
    sandNoise: [0.030, 0.016, 0.008],
    dune: [0.52, 0.30, 0.16],          // wind-sorted, paler
    wash: [0.46, 0.34, 0.22],          // a dry wash's bed
    scrub: [0.11, 0.11, 0.065],        // sage and blackbrush
    rock: [0.38, 0.12, 0.05],          // Entrada-red cliffs
    rockLight: [0.47, 0.26, 0.14],     // the paler bands
    varnish: [0.09, 0.05, 0.035],      // desert varnish under the caprock
    caprock: [0.40, 0.29, 0.18],       // the mesa tops
    talus: [0.30, 0.15, 0.08],
    boulder: 0xa05a3a,
  },
  arctic: {
    snow: [0.70, 0.72, 0.76],          // a little under the mountains' 0.85: a whole valley of it
    drift: [0.58, 0.63, 0.70],         // wind-packed snow, bluer
    ice: [0.27, 0.37, 0.44],           // lake ice the wind has cleared
    iceDark: [0.12, 0.19, 0.24],       // clear black ice, thick and old
    rock: [0.085, 0.085, 0.09],        // bare rock on the steep faces
    scree: [0.30, 0.31, 0.33],
    underTrees: [0.46, 0.50, 0.55],    // snow in the shade of a wood, and the needles and twigs on it
    spruce: { h: 0.40, hVary: 0.03, s: 0.30, l: 0.032, lVary: 0.012 },
    snowOnTree: [0.70, 0.73, 0.78],
    boulder: 0x4a4b4f,
    shacks: [0xb03a2e, 0x2f6fa8, 0xd9a62b, 0x4a7a3a, 0x8a3fa0],
    shackRoof: 0x3a3a3c,
  },
  runway: {
    ice: '#7f95a1',                    // ploughed lake ice
    snow: '#dfe3e6',                   // packed snow
    bank: '#f1f3f5',                   // the ploughed snow banks at its edges
  },
};
