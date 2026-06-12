// ===========================================================================
// PLAYER IDENTITY — src/net/identity.js
// ---------------------------------------------------------------------------
// Owns the player's display name + detected country, persisted in a cookie so
// it survives across sessions (and is sent with leaderboard submissions).
//
// ABOUT "ENCRYPTED" STORAGE — read this:
//   A cookie written by browser JS can only be obfuscated, not truly secured:
//   whatever key we'd use to encrypt is also shipped to the browser, so anyone
//   can read it. We therefore do light obfuscation here (enough that the value
//   isn't plainly visible in devtools) and DON'T pretend it's secret. A display
//   name + country aren't sensitive, so this is fine.
//
//   If you later want REAL encryption/tamper-proofing, the proper way is a
//   server-set cookie: POST the name to an endpoint that sets an httpOnly,
//   Secure, signed (or AES-encrypted with a server-only key) cookie. JS can't
//   read or forge it then. The `requireWrite()` hook in api/_db.js is where that
//   signed identity would be verified. Left as a clean upgrade path.
// ===========================================================================

import { clientId } from './scores.js';

const NAME_COOKIE = 'slayfit_id';
const MAX_AGE_DAYS = 365;

// --- tiny obfuscation (XOR + base64). NOT cryptography — see header note. -----
const SALT = 'slayfit~v1';
function obfuscate(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length));
  }
  try { return btoa(unescape(encodeURIComponent(out))); } catch { return ''; }
}
function deobfuscate(b64) {
  try {
    const raw = decodeURIComponent(escape(atob(b64)));
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      out += String.fromCharCode(raw.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length));
    }
    return out;
  } catch { return ''; }
}

// --- cookie helpers ----------------------------------------------------------
function setCookie(name, value, days = MAX_AGE_DAYS) {
  try {
    const exp = new Date(Date.now() + days * 864e5).toUTCString();
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${value}; Expires=${exp}; Path=/; SameSite=Lax${secure}`;
  } catch {}
}
function getCookie(name) {
  try {
    return document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.split('=')[1] || '';
  } catch { return ''; }
}

// --- identity record { name, country } --------------------------------------
function read() {
  const raw = getCookie(NAME_COOKIE);
  if (!raw) return { name: '', country: null };
  try {
    const obj = JSON.parse(deobfuscate(raw));
    return { name: obj.name || '', country: obj.country || null };
  } catch { return { name: '', country: null }; }
}
function write(rec) {
  setCookie(NAME_COOKIE, obfuscate(JSON.stringify(rec)));
}

export function getName() { return read().name; }

export function setName(name) {
  const clean = String(name || '').trim().slice(0, 40);
  const rec = read(); rec.name = clean; write(rec);
  return clean;
}

export function getCountry() { return read().country; }

// Persist the country the SERVER detected (returned by /api/score GET & POST).
// We don't run a separate /api/geo call — the score endpoint already reports it.
export function setCountry(country) {
  if (!country || country === getCountry()) return;
  const rec = read(); rec.country = country; write(rec);
}

// Full identity for a submission: { name, country, clientId }.
export function identity() {
  const rec = read();
  return { name: rec.name, country: rec.country, clientId: clientId() };
}

// ISO alpha-2 -> flag emoji (regional indicators). 'US' -> 🇺🇸.
export function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '';
  const A = 0x1f1e6;
  const up = cc.toUpperCase();
  return String.fromCodePoint(A + (up.charCodeAt(0) - 65), A + (up.charCodeAt(1) - 65));
}
