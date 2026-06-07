// ===========================================================================
// PUNCH DETECTOR — pure. Detects a fast outward wrist extension per arm.
// Stateful only via the `detector` object you create; thresholds come from
// config/moves.config.js. Null-safe: missing/low-confidence landmarks => no-op.
// ===========================================================================

import { MOVE_THRESHOLDS } from '../config/moves.config.js';

const L = { shoulder: 11, wrist: 15 };
const R = { shoulder: 12, wrist: 16 };

export function createPunchDetector(cfg = MOVE_THRESHOLDS.punch, minVis = MOVE_THRESHOLDS.minVisibility) {
  // Per-arm previous wrist position + cooldown timestamps.
  const prev = { left: null, right: null };
  const lastFire = { left: 0, right: 0 };

  function valid(p) {
    return p && (p.visibility == null || p.visibility >= minVis);
  }

  function detectArm(lm, side, idx, dtMs, now) {
    const wrist = lm[idx.wrist];
    const shoulder = lm[idx.shoulder];
    if (!valid(wrist) || !valid(shoulder)) {
      prev[side] = null;
      return null;
    }
    const ext = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y);
    let vel = 0;
    if (prev[side] && dtMs > 0) {
      const dx = wrist.x - prev[side].x;
      const dy = wrist.y - prev[side].y;
      vel = Math.hypot(dx, dy) / (dtMs / 1000);
    }
    prev[side] = { x: wrist.x, y: wrist.y };

    if (
      ext >= cfg.minExtension &&
      vel >= cfg.minVelocity &&
      now - lastFire[side] >= cfg.cooldownMs
    ) {
      lastFire[side] = now;
      // Punch lands toward the wrist position (mirror x for selfie view handled upstream).
      return { type: 'punch', payload: { x: wrist.x, y: wrist.y, side } };
    }
    return null;
  }

  return {
    /**
     * @param {Array} landmarks normalized MediaPipe landmarks (may be null)
     * @param {number} dtMs
     * @param {number} now
     * @returns {Array} zero, one or two punch moves
     */
    detect(landmarks, dtMs, now) {
      if (!landmarks) {
        prev.left = prev.right = null;
        return [];
      }
      const out = [];
      const l = detectArm(landmarks, 'left', L, dtMs, now);
      const r = detectArm(landmarks, 'right', R, dtMs, now);
      if (l) out.push(l);
      if (r) out.push(r);
      return out;
    },
  };
}
