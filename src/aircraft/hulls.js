// Probe spheres for obstacle collision, in the body frame of each aircraft (metres from the CG; forward -Z,
// up +Y, right +X): nose, tail, fin tops, wingtips and winglets, stabiliser tips, nacelles, and samples along
// the wing leading and trailing edges close enough that no mast or cable fits between them.
//
// These are NOT the physics contact points (def.bodyPoints in defs.js, which only meet the ground); they are
// read by src/world/obstacles.js after each step. Measured from the airframes (src/art/airframes/*.js).
//
// STUB (skeleton, 2026-09-17): empty.

export const HULLS = {};
