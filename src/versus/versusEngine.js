// ===========================================================================
// VERSUS ENGINE — match state + defender-authoritative hit judging.
// ---------------------------------------------------------------------------
// RULE (docs/versus-netcode.md §5): each peer is the SOLE authority over its
// OWN body & HP. This engine therefore decides, for THIS player:
//   - when an incoming opponent punch lands vs is blocked (vs my OWN guard
//     history, with a reaction window), and subtracts from MY hp;
//   - mirrors the opponent's hp purely from their HEALTH packets (display only).
// No spatial overlap between two independently-filmed cameras is used — that's
// meaningless; combat is "punch event vs defender guard", which is real and
// reaction-based.
// ===========================================================================

export const VERSUS_DEFAULTS = {
  hpMax: 100,
  hitDmg: 10,
  blockChip: 2,
  guardWindowMs: 180,   // reaction tolerance around a punch's timestamp
};

export function createVersusEngine(opts = {}) {
  const cfg = { ...VERSUS_DEFAULTS, ...opts };

  let selfHp = cfg.hpMax;
  let oppHp = cfg.hpMax;
  let over = false;
  let winner = null;        // 'self' | 'opponent'
  let selfBlocks = 0, selfHits = 0, landed = 0;

  // Local guard history as intervals on the shared match clock.
  const intervals = [];     // closed { start, end }
  let openSince = null;     // currently-up interval start, or null

  function registerLocalGuard(up, t) {
    if (up && openSince == null) {
      openSince = t;
    } else if (!up && openSince != null) {
      intervals.push({ start: openSince, end: t });
      openSince = null;
      while (intervals.length > 12) intervals.shift();
    }
  }

  // Was my guard up at any instant within ±win of tHit?
  function guardActiveAround(tHit, win) {
    const lo = tHit - win, hi = tHit + win;
    if (openSince != null && openSince <= hi) return true; // open interval -> ∞
    for (const iv of intervals) if (iv.start <= hi && iv.end >= lo) return true;
    return false;
  }

  /**
   * An opponent punch arrived (timestamped on the shared clock). Judge against
   * MY guard, subtract from MY hp. Returns the outcome for FX + the new hp to
   * broadcast in a HEALTH packet.
   */
  function onIncomingPunch(punch) {
    if (over) return { ignored: true };
    const blocked = guardActiveAround(punch.t, cfg.guardWindowMs);
    const dmg = blocked ? cfg.blockChip : cfg.hitDmg;
    selfHp = Math.max(0, selfHp - dmg);
    if (blocked) selfBlocks++; else selfHits++;
    const ko = selfHp <= 0;
    if (ko) { over = true; winner = 'opponent'; }
    return { blocked, dmg, selfHp, ko };
  }

  /** Mirror the opponent's hp from their HEALTH packet (they own it). */
  function setOppHp(hp) {
    oppHp = Math.max(0, Math.min(cfg.hpMax, hp));
    if (oppHp <= 0 && !over) { over = true; winner = 'self'; }
  }

  /** Count a punch I threw that the opponent later confirms as a hit (optional). */
  function noteLandedConfirmed() { landed++; }

  return {
    cfg,
    registerLocalGuard,
    guardActiveAround,
    onIncomingPunch,
    setOppHp,
    noteLandedConfirmed,
    forceOver: (w) => { over = true; winner = w; },
    state: () => ({ selfHp, oppHp, over, winner, selfBlocks, selfHits, landed }),
  };
}
