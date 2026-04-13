const DB_NAME = 'perspective-correction';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const LS_KEY = 'pc-session';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Saves folder session state: dirHandle to IndexedDB, index + points to localStorage.
 */
export async function saveSession(dirHandle, imageIndex, normalizedPoints) {
  try {
    const db = await openDB();
    await idbPut(db, 'folderHandle', dirHandle);
    db.close();
    localStorage.setItem(LS_KEY, JSON.stringify({
      imageIndex,
      normalizedPoints: normalizedPoints || null,
    }));
  } catch (e) {
    console.warn('Failed to save session:', e);
  }
}

/**
 * Restores folder session state.
 * Returns { dirHandle, imageIndex, normalizedPoints } or null if unavailable.
 * Requests permission on the stored handle; returns null if denied.
 */
export async function restoreSession() {
  try {
    const db = await openDB();
    const dirHandle = await idbGet(db, 'folderHandle');
    db.close();
    if (!dirHandle) return null;

    // Re-verify permission (requires prior user gesture in some browsers)
    const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;

    const raw = localStorage.getItem(LS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return {
      dirHandle,
      imageIndex: data.imageIndex ?? 0,
      normalizedPoints: data.normalizedPoints ?? null,
    };
  } catch (e) {
    console.warn('Failed to restore session:', e);
    return null;
  }
}

/**
 * Clears saved session state.
 */
export async function clearSession() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => db.close();
    localStorage.removeItem(LS_KEY);
  } catch (e) {
    console.warn('Failed to clear session:', e);
  }
}
