// ===========================================================================
// Temple Dash — CAMPAIGN MANIFEST.
// ---------------------------------------------------------------------------
// An ordered list of levels played in sequence as a single campaign. Each entry
// is just a display name + the URL of its JSON map (served from public/). The
// React shell (ui/TempleDash.jsx) walks this array, fetching each map and
// (re)creating the engine per level while a shared 3-lives pool persists.
//
// Map shapes (both consumed by createTempleEngine via its `map` arg):
//   • linear : { name, params, segments:[{turn,hazards:[{type,at}]}] }
//   • maze   : { name, mode:"maze", params, junctions:[{correct,hazards:[…]}] }
//
// Progression: L1 is a gentle LINEAR teaching run (jump → duck → turn); L2 and
// L3 are hand-authored, PRE-DETERMINED maze maps (mode:"maze") of rising
// difficulty. Straight progression — no level select.
// ===========================================================================
import { assetUrl } from './assetUrl.js';
export const LEVELS = [
  { name: 'The Winding Halls', map: assetUrl('assets/temple/level1.json') },     // no hazards — a calm multi-junction maze to learn map-reading
  { name: 'Whispering Blades', map: assetUrl('assets/temple/level2.json') },     // blades + fallen beams
  { name: 'The Sunken Deep',  map: assetUrl('assets/temple/level3_maze.json') }, // + cracked floor
  { name: "The Lion's Maw",   map: assetUrl('assets/temple/level4_maze.json') }, // + fire-spitting lion
  { name: 'The Sunstone',     map: assetUrl('assets/temple/level5_maze.json') }, // take the artifact
  { name: 'Into Daylight',    map: assetUrl('assets/temple/level6_maze.json') }, // escape the temple
];

export default LEVELS;
