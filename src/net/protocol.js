// ===========================================================================
// VERSUS PROTOCOL — compact binary encode/decode for every packet type.
// ---------------------------------------------------------------------------
// First byte = type tag; the rest is packed with a DataView. POSE is the only
// high-rate packet so it's kept tiny: a reduced 15-joint set, x/y quantized to
// int16 (normalized 0..1 -> 0..32767) + a visibility bitmask. See
// docs/versus-netcode.md §4. Pure + environment-agnostic (browser & Node).
// ===========================================================================

export const T = {
  HELLO: 1,
  PING: 2,
  PONG: 3,
  POSE: 4,
  PUNCH: 5,
  GUARD: 6,
  HEALTH: 7,
  KO: 8,
};

export const PROTOCOL_VERSION = 1;

// The 15 MediaPipe Pose indices the avatar rig actually needs. Order matters:
// it defines the on-wire slot order.
export const POSE_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 7, 8];

const Q = 32767;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const quant = (v) => Math.round(clamp01(v) * Q);

function buf(len) {
  const ab = new ArrayBuffer(len);
  return { ab, dv: new DataView(ab), u8: new Uint8Array(ab) };
}
const out = (u8) => u8; // packets are Uint8Array

// ---- encoders -------------------------------------------------------------

export function encodeHello(playerId, matchStart) {
  const { dv, u8 } = buf(1 + 1 + 1 + 8);
  dv.setUint8(0, T.HELLO);
  dv.setUint8(1, PROTOCOL_VERSION);
  dv.setUint8(2, playerId & 0xff);
  dv.setFloat64(3, matchStart);
  return out(u8);
}

export function encodePing(t0) {
  const { dv, u8 } = buf(1 + 8);
  dv.setUint8(0, T.PING);
  dv.setFloat64(1, t0);
  return out(u8);
}

export function encodePong(t0, t1) {
  const { dv, u8 } = buf(1 + 8 + 8);
  dv.setUint8(0, T.PONG);
  dv.setFloat64(1, t0);
  dv.setFloat64(9, t1);
  return out(u8);
}

/**
 * @param {number} t  shared-clock timestamp
 * @param {Array} landmarks  full (or partial) MediaPipe landmark array
 */
export function encodePose(t, landmarks) {
  const n = POSE_JOINTS.length;
  const { dv, u8 } = buf(1 + 8 + 2 + n * 4);
  dv.setUint8(0, T.POSE);
  dv.setFloat64(1, t);
  let mask = 0;
  let off = 11;
  for (let i = 0; i < n; i++) {
    const p = landmarks && landmarks[POSE_JOINTS[i]];
    const vis = p && (p.visibility == null || p.visibility >= 0.4);
    if (vis) mask |= (1 << i);
    dv.setInt16(off, vis ? quant(p.x) : 0);
    dv.setInt16(off + 2, vis ? quant(p.y) : 0);
    off += 4;
  }
  dv.setUint16(9, mask);
  return out(u8);
}

export function encodePunch(t, side, fx, fy, kind = 0) {
  const { dv, u8 } = buf(1 + 8 + 1 + 2 + 2 + 1);
  dv.setUint8(0, T.PUNCH);
  dv.setFloat64(1, t);
  dv.setUint8(9, side === 'right' ? 1 : 0);
  dv.setInt16(10, quant(fx));
  dv.setInt16(12, quant(fy));
  dv.setUint8(14, kind & 0xff);
  return out(u8);
}

export function encodeGuard(t, up) {
  const { dv, u8 } = buf(1 + 8 + 1);
  dv.setUint8(0, T.GUARD);
  dv.setFloat64(1, t);
  dv.setUint8(9, up ? 1 : 0);
  return out(u8);
}

export function encodeHealth(t, hp) {
  const { dv, u8 } = buf(1 + 8 + 1);
  dv.setUint8(0, T.HEALTH);
  dv.setFloat64(1, t);
  dv.setUint8(9, Math.max(0, Math.min(100, Math.round(hp))));
  return out(u8);
}

export function encodeKO(t, who) {
  const { dv, u8 } = buf(1 + 8 + 1);
  dv.setUint8(0, T.KO);
  dv.setFloat64(1, t);
  dv.setUint8(9, who & 0xff);
  return out(u8);
}

// ---- decoder --------------------------------------------------------------

/** @param {Uint8Array|ArrayBuffer} bytes @returns {object} { type, ... } */
export function decode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const type = dv.getUint8(0);
  switch (type) {
    case T.HELLO:
      return { type, version: dv.getUint8(1), playerId: dv.getUint8(2), matchStart: dv.getFloat64(3) };
    case T.PING:
      return { type, t0: dv.getFloat64(1) };
    case T.PONG:
      return { type, t0: dv.getFloat64(1), t1: dv.getFloat64(9) };
    case T.POSE: {
      const t = dv.getFloat64(1);
      const mask = dv.getUint16(9);
      const landmarks = new Array(33).fill(null);
      let off = 11;
      for (let i = 0; i < POSE_JOINTS.length; i++) {
        const vis = (mask >> i) & 1;
        const x = dv.getInt16(off) / Q;
        const y = dv.getInt16(off + 2) / Q;
        off += 4;
        landmarks[POSE_JOINTS[i]] = vis ? { x, y, visibility: 1 } : { x: 0, y: 0, visibility: 0 };
      }
      return { type, t, landmarks };
    }
    case T.PUNCH:
      return {
        type, t: dv.getFloat64(1),
        side: dv.getUint8(9) ? 'right' : 'left',
        fx: dv.getInt16(10) / Q, fy: dv.getInt16(12) / Q,
        kind: dv.getUint8(14),
      };
    case T.GUARD:
      return { type, t: dv.getFloat64(1), up: !!dv.getUint8(9) };
    case T.HEALTH:
      return { type, t: dv.getFloat64(1), hp: dv.getUint8(9) };
    case T.KO:
      return { type, t: dv.getFloat64(1), who: dv.getUint8(9) };
    default:
      return { type: 0, raw: u8 };
  }
}
