// ===========================================================================
// PEER LINK — short room-code signaling via the public PeerJS broker.
// ---------------------------------------------------------------------------
// Produces the SAME DataLink interface as the loopback link (send/onMessage/
// onOpen/onClose/readyState/close), so the session/engine/scene are unchanged. The
// PeerJS broker only brokers the handshake — once connected, the DataConnection
// is direct P2P (no match data touches the broker). See docs/versus-netcode.md.
//
// Uses the DEFAULT public PeerJS Cloud broker (0.peerjs.com) — no self-hosting.
// `PeerImpl` is injectable so tests can pass a mock broker.
// ===========================================================================

import Peer from 'peerjs';

// Human-friendly room codes: no ambiguous chars (O/0, I/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genRoomCode(n = 6) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// Normalize whatever PeerJS hands us into a Uint8Array.
function toBytes(d) {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (d && d.buffer instanceof ArrayBuffer) return new Uint8Array(d.buffer, d.byteOffset || 0, d.byteLength);
  if (Array.isArray(d)) return Uint8Array.from(d);
  return new Uint8Array(0);
}

// Reliable+ordered single channel (keeps HP/KO packets safe). Raw bytes — no
// BinaryPack wrapping. (A future optimization is a 2nd unreliable channel for
// pose; one channel is plenty for V1.)
const CONN_OPTS = { reliable: true, serialization: 'raw' };

function makeLink(conn) {
  const msgCbs = [], openCbs = [], closeCbs = [];
  let opened = false;
  conn.on('open', () => { opened = true; for (const f of openCbs) f(); });
  conn.on('data', (d) => { const b = toBytes(d); for (const f of msgCbs) f(b); });
  conn.on('close', () => { for (const f of closeCbs) f(); });
  return {
    send: (bytes) => { try { if (conn.open) conn.send(bytes); } catch {} },
    onMessage: (cb) => msgCbs.push(cb),
    onOpen: (cb) => { if (opened) cb(); else openCbs.push(cb); },
    onClose: (cb) => closeCbs.push(cb),
    get readyState() { return conn.open ? 'open' : 'connecting'; },
    close: () => { try { conn.close(); } catch {} },
  };
}

/**
 * HOST: register a short room code with the broker and wait for the opponent.
 * @param {{ onCode, onLink, onError, peerOptions?, PeerImpl?, maxTries? }} o
 */
export function createPeerHost({ onCode, onLink, onError, peerOptions, PeerImpl = Peer, maxTries = 6 } = {}) {
  let peer = null, closed = false, tries = 0;

  function attempt() {
    if (closed) return;
    const code = genRoomCode();
    peer = peerOptions ? new PeerImpl(code, peerOptions) : new PeerImpl(code);
    peer.on('open', (id) => { if (!closed) onCode && onCode(id || code); });
    peer.on('connection', (conn) => { if (!closed) onLink && onLink(makeLink(conn)); });
    peer.on('error', (err) => {
      // Code already taken — just try another short code a few times.
      if (err && err.type === 'unavailable-id' && tries++ < maxTries) {
        try { peer.destroy(); } catch {}
        attempt();
      } else if (!closed) { onError && onError(err); }
    });
  }
  attempt();

  return { close: () => { closed = true; try { peer && peer.destroy(); } catch {} }, get peer() { return peer; } };
}

/**
 * GUEST: connect to a host's room code.
 * @param {{ code, onLink, onError, peerOptions?, PeerImpl? }} o
 */
export function createPeerJoin({ code, onLink, onError, peerOptions, PeerImpl = Peer } = {}) {
  let closed = false;
  const peer = peerOptions ? new PeerImpl(undefined, peerOptions) : new PeerImpl();
  peer.on('open', () => {
    if (closed) return;
    const conn = peer.connect(code, CONN_OPTS);
    if (!conn) { onError && onError(new Error('could not start connection')); return; }
    conn.on('error', (e) => onError && onError(e));
    onLink && onLink(makeLink(conn));
  });
  peer.on('error', (err) => { if (!closed) onError && onError(err); });

  return { close: () => { closed = true; try { peer.destroy(); } catch {} }, get peer() { return peer; } };
}
