// ===========================================================================
// Temple / Relic Hunter — CLIP STORE (IndexedDB, THROWAWAY dev recordings).
// ---------------------------------------------------------------------------
// A tiny promise-wrapped IndexedDB store that holds gameplay clips recorded by
// clipRecorder.js — kept in their OWN database ('relichunter-recordings', store
// 'clips') so they're isolated from game save data and can be wiped in one call.
// The viewer page (public/recordings.html) reads from this same store.
//
//   saveClip({ blob, mime, durationMs, w, h, level }) -> Promise<id>
//   listClips()  -> Promise<[{ id, name, mime, durationMs, size, w, h, createdAt }]>  (no blobs)
//   getClip(id)  -> Promise<{ ...meta, blob }>
//   deleteClip(id) -> Promise<void>
//   clearAll()   -> Promise<void>
// ===========================================================================

const DB_NAME = 'relichunter-recordings';
const STORE = 'clips';
const VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function saveClip({ blob, mime, durationMs = 0, w = 0, h = 0, level = null } = {}) {
  const db = await openDB();
  const createdAt = Date.now();
  const stamp = new Date(createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  const name = `relic-hunter_${level != null ? 'L' + level + '_' : ''}` +
    `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_` +
    `${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
  const rec = { name, blob, mime: mime || blob.type || 'video/webm', durationMs, w, h, level, size: blob.size, createdAt };
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').add(rec);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listClips() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = tx(db, 'readonly').openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        const { blob, ...meta } = cur.value;   // omit the heavy blob in the listing
        out.push(meta);
        cur.continue();
      } else {
        out.sort((a, b) => b.createdAt - a.createdAt);
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getClip(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteClip(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export default { saveClip, listClips, getClip, deleteClip, clearAll };
