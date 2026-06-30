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
export const LEVELS = [
  { name: 'The Long Hall', map: '/assets/temple/level1.json' },   // gentle linear intro
  { name: 'Bladeworks',    map: '/assets/temple/level2.json' },   // first maze (mode:"maze")
  { name: 'The Labyrinth', map: '/assets/temple/level3_maze.json' }, // hard maze (mode:"maze")
];

export default LEVELS;
