// ===========================================================================
// Temple Collapse — GRID HAZARDS (traps on maze cells: placement + judging).
// ---------------------------------------------------------------------------
// Consumes map.hazardCells ([{ type, r, c, dir, mode? }] from mazeGen's
// placeGridHazards — the SAME list the minimap draws icons from) and:
//   • builds each trap's 3D prop at its cell via the shared hazardProps
//     recipes, oriented along the corridor axis (`dir`);
//   • owns the per-run judge state: telegraph cues on approach, action
//     windows for a clean clear, and the consequence when a trap is reached
//     un-cleared. The ENGINE decides what a consequence means (stumble /
//     death / fall) — this module only reports events.
//
//   createGridHazards({ THREE, scene, props, cells, cellW }) -> {
//     judge(action, x, z),   // 'jump'|'duck' press -> cleared trap type | null
//     step(x, z, fwd, emit), // per-frame: emit('cue', {...}) | emit(type, hz)
//     reset(),               // new run: re-arm every trap (props stay built)
//   }
// Grid→world matches gridMaze/gridGeometry: cell (r,c) -> (x=c*cellW, z=-r*cellW).
// ===========================================================================
import { PLAY, CRACK } from '../config.js';

// world forward per travel direction (identical to gridMaze's HVEC).
const FWD = { N: { x: 0, z: 1 }, S: { x: 0, z: -1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } };
const CRACK_HALF = CRACK.len / 2;
const HIT_TOL = 0.9;            // reached the trap centre un-cleared -> consequence
const LEAD = PLAY.cueLead;      // telegraph distance
const HAZ_WIN = PLAY.hazWin;    // action half-window for a clean clear

// which press clears which trap (fire depends on the jet height).
const CLEARS = {
  jump: (h) => h.type === 'beam' || h.type === 'crack' || (h.type === 'fire' && !h.duck),
  duck: (h) => h.type === 'blade' || (h.type === 'fire' && h.duck),
};
const CUES = {
  blade: { text: 'DUCK!', color: '#ff4a3a', action: 'duck' },
  crack: { text: 'JUMP!', color: '#ffd23a', action: 'jump' },
  fire: (h) => ({ text: h.duck ? 'DUCK!' : 'JUMP!', color: '#ff7a1e', action: h.duck ? 'duck' : 'jump' }),
  // beams are non-lethal + readable on the floor: no telegraph (parity with the original).
};

export function createGridHazards({ THREE, scene, props, cells = [], cellW = 14 } = {}) {
  const up = new THREE.Vector3(0, 1, 0);

  // ---- build every trap prop at its cell, oriented along the corridor ---------
  const list = cells.map((h, i) => {
    const fwd = FWD[h.dir] || FWD.N;
    const cx = h.c * cellW, cz = -h.r * cellW;
    const right = { x: fwd.z, z: -fwd.x };                 // up × fwd
    // local hall frame: x across, y up, z NEGATIVE = forward (templeEngine convention)
    const place = (lx, ly, lz) => new THREE.Vector3(
      cx + right.x * lx - fwd.x * lz, ly, cz + right.z * lx - fwd.z * lz,
    );
    const quat = new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(-fwd.x, -fwd.z));
    const duck = h.mode === 'duck';
    if (h.type === 'beam') props.buildBeam(place, quat);
    else if (h.type === 'blade') props.buildBlade(place, quat, i * 1.7);
    else if (h.type === 'fire') props.buildFire(place, quat, duck);
    else if (h.type === 'crack') props.buildCrack(place, quat);
    return { type: h.type, duck, x: cx, z: cz, done: false, armed: false };
  });

  const winFor = (h) => (h.type === 'crack' ? CRACK_HALF + HAZ_WIN : HAZ_WIN);

  // A jump/duck press: clear the nearest matching live trap inside its window.
  function judge(action, x, z) {
    const match = CLEARS[action];
    if (!match) return null;
    let best = null, bestD = Infinity;
    for (const h of list) {
      if (h.done || !match(h)) continue;
      const d = Math.hypot(h.x - x, h.z - z);
      if (d <= winFor(h) && d < bestD) { best = h; bestD = d; }
    }
    if (best) { best.done = true; return best.type; }
    return null;
  }

  // Per-frame: telegraphs on approach + consequences on reaching a live trap.
  // `fwd` = the player's world heading (unit); perp gating keeps a trap in a
  // PARALLEL corridor from arming cues through the wall.
  function step(x, z, fwd, emit) {
    for (const h of list) {
      if (h.done) continue;
      const dx = h.x - x, dz = h.z - z;
      const proj = dx * fwd.x + dz * fwd.z;                 // distance ahead along travel
      const perp = Math.abs(dx * fwd.z - dz * fwd.x);       // off-axis distance
      if (!h.armed && proj > 0 && proj <= LEAD && perp < cellW * 0.5) {
        h.armed = true;
        const cue = typeof CUES[h.type] === 'function' ? CUES[h.type](h) : CUES[h.type];
        if (cue) emit('cue', cue);
      }
      if (perp >= 2) continue;
      if (h.type === 'crack') {
        // the fall triggers at the gap's NEAR EDGE (you run into the chasm).
        if (proj <= CRACK_HALF - 0.4 && proj > -CRACK_HALF) { h.done = true; emit('crack', h); return; }
      } else if (Math.hypot(dx, dz) <= HIT_TOL) {
        h.done = true; emit(h.type, h); return;
      }
    }
  }

  function reset() { list.forEach((h) => { h.done = false; h.armed = false; }); }

  return { judge, step, reset };
}

export default createGridHazards;
