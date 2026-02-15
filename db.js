// db.js — IndexedDB storage for Dash Log
// Stores: zones, sessions
// No external libraries.

const DB_NAME = "dashlog-db";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("zones")) {
        const zones = db.createObjectStore("zones", { keyPath: "id", autoIncrement: true });
        zones.createIndex("by_name", "name", { unique: true });
        zones.createIndex("by_active", "active", { unique: false });
      }

      if (!db.objectStoreNames.contains("sessions")) {
        const sessions = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
        sessions.createIndex("by_start", "start_time", { unique: false });
        sessions.createIndex("by_week", "week_start", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runTx(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    Promise.resolve(fn(store))
      .then((result) => {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
      .catch(reject);
  });
}

export async function initDB() {
  const db = await openDB();

  // seed zones if empty
  const zones = await listZones(db, { activeOnly: false });
  if (zones.length === 0) {
    await addZone(db, "Allen");
    await addZone(db, "Plano");
    await addZone(db, "McKinney");
  }

  return db;
}

/* Zones */
export async function listZones(db, { activeOnly = true } = {}) {
  return runTx(db, "zones", "readonly", async (store) => {
    const all = await reqToPromise(store.getAll());
    const sorted = all.sort((a, b) => a.name.localeCompare(b.name));
    return activeOnly ? sorted.filter(z => z.active === 1) : sorted;
  });
}

export async function addZone(db, name) {
  const zone = { name: name.trim(), active: 1 };
  return runTx(db, "zones", "readwrite", async (store) => {
    return reqToPromise(store.add(zone));
  });
}

export async function updateZone(db, zone) {
  return runTx(db, "zones", "readwrite", async (store) => {
    return reqToPromise(store.put(zone));
  });
}

/* Sessions */
export async function addSession(db, session) {
  return runTx(db, "sessions", "readwrite", async (store) => {
    return reqToPromise(store.add(session));
  });
}

export async function updateSession(db, session) {
  return runTx(db, "sessions", "readwrite", async (store) => {
    return reqToPromise(store.put(session));
  });
}

export async function deleteSession(db, id) {
  return runTx(db, "sessions", "readwrite", async (store) => {
    return reqToPromise(store.delete(id));
  });
}

export async function listSessions(db, { limit = 50 } = {}) {
  return runTx(db, "sessions", "readonly", async (store) => {
    const idx = store.index("by_start");
    const req = idx.openCursor(null, "prev");
    const out = [];

    return new Promise((resolve, reject) => {
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || out.length >= limit) return resolve(out);
        out.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function listAllSessions(db) {
  return runTx(db, "sessions", "readonly", async (store) => {
    return reqToPromise(store.getAll());
  });
}