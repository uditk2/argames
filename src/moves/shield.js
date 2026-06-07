// ===========================================================================
// SHIELD DETECTOR — pure. Detects "arms up" (both wrists above shoulders).
// Emits a 'shield' move when entering the pose and 'shield-end' on exit so the
// engine can toggle the ward. Null-safe.
// ===========================================================================

import { MOVE_THRESHOLDS } from '../config/moves.config.js';

const L = { shoulder: 11, wrist: 15 };
const R = { shoulder: 12, wrist: 16 };

export function createShieldDetector(cfg = MOVE_THRESHOLDS.shield, minVis = MOVE_THRESHOLDS.minVisibility) {
  let active = false;
  let heldSince = 0;

  function valid(p) {
    return p && (p.visibility == null || p.visibility >= minVis);
  }

  // NOTE: image y grows downward, so "above" means a SMALLER y value.
  function armUp(lm, idx) {
    const w = lm[idx.wrist];
    const s = lm[idx.shoulder];
    if (!valid(w) || !valid(s)) return false;
    return s.y - w.y >= cfg.wristAboveShoulderBy;
  }

  return {
    /** @returns {Array} 'shield' / 'shield-end' moves */
    detect(landmarks, dtMs, now) {
      if (!landmarks) {
        if (active) {
          active = false;
          return [{ type: 'shield-end' }];
        }
        return [];
      }
      const up = cfg.bothArms
        ? armUp(landmarks, L) && armUp(landmarks, R)
        : armUp(landmarks, L) || armUp(landmarks, R);

      if (up && !active) {
        if (!heldSince) heldSince = now;
        if (now - heldSince >= cfg.holdMs) {
          active = true;
          return [{ type: 'shield' }];
        }
      } else if (!up) {
        heldSince = 0;
        if (active) {
          active = false;
          return [{ type: 'shield-end' }];
        }
      }
      return [];
    },
  };
}
