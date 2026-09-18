// How the ground looks: the terrain mesh and everything scattered on it.
//
// This is the door src/world/terrain.js comes through; the work lives in three
// modules next to it, one per brief:
//
//   world-ground.js      the terrain mesh, its colours and material   (groundColor, buildGround, parcel)
//   world-vegetation.js  forests, hedgerows, the obstacle trees        (buildForest, OBSTACLE_TREE, buildObstacleTrees)
//   world-props.js       boulders, roads, villages                     (buildRocks, buildRoad, buildVillage)
//
// The split with world/terrain.js is the important thing. That file owns what the
// terrain IS - the heightfield, the ground query the physics calls every frame, the
// flattened areas around runways, the obstacle list. These files own what it LOOKS
// like. Nothing in here may change a height, a surface type, a friction coefficient
// or an obstacle. Every export below is read by name from the world; keep them.
export { groundColor, buildGround, parcel } from './world-ground.js';
export { buildForest, OBSTACLE_TREE, buildObstacleTrees } from './world-vegetation.js';
export { buildRocks, buildRoad, buildVillage } from './world-props.js';
// Mission obstacles (towers, bridges, cables, gates): the look of src/world/obstacles.js.
export { buildCourse } from './city-look.js';
