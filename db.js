// db.js — IndexedDB storage for Gig Log (zones + sessions)
// DB v3 adds a "meta" store for settings + draft (optional), but we also use localStorage.

const DB_NAME = "giglog-db";
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("zones")) {
        const zones = db.createObjectStore("zones", { keyPath: "id", autoIncrement: true });
        zones.createIndex("by_name", "name", { unique: false });
        zones.createIndex("by_active", "active", { unique: false });
      }

      if (!db.objectStoreNames.contains("sessions")) {
        const sessions = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
        sessions.createIndex("by_start", "start_time", { unique: false });
        sessions.createIndex("by_week", "week_start", { unique: false });
      }

      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
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

/* ---------- Zones ---------- */
export async function listZones(db, { activeOnly = true } = {}) {
  return runTx(db, "zones", "readonly", async (store) => {
    const all = await reqToPromise(store.getAll());

    // Back-compat: if old zones didn't have active, treat as active.
    for (const z of all) {
      if (typeof z.active !== "number") z.active = 1;
    }

    const sorted = all.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return activeOnly ? sorted.filter(z => z.active === 1) : sorted;
  });
}

export async function addZone(db, name) {
  const zone = { name: name.trim(), active: 1 };
  return runTx(db, "zones", "readwrite", async (store) => reqToPromise(store.add(zone)));
}

export async function updateZone(db, zone) {
  return runTx(db, "zones", "readwrite", async (store) => reqToPromise(store.put(zone)));
}

async function ensureZone(db, name) {
  const all = await listZones(db, { activeOnly: false });
  const found = all.find(z => String(z.name).toLowerCase() === name.toLowerCase());
  if (found) {
    if (found.active !== 1) {
      found.active = 1;
      await updateZone(db, found);
    }
    return found.id;
  }
  try { return await addZone(db, name); } catch { return null; }
}

/* ---------- Sessions ---------- */
export async function addSession(db, session) {
  return runTx(db, "sessions", "readwrite", async (store) => reqToPromise(store.add(session)));
}

export async function updateSession(db, session) {
  return runTx(db, "sessions", "readwrite", async (store) => reqToPromise(store.put(session)));
}

export async function deleteSession(db, id) {
  return runTx(db, "sessions", "readwrite", async (store) => reqToPromise(store.delete(id)));
}

export async function getSession(db, id) {
  return runTx(db, "sessions", "readonly", async (store) => reqToPromise(store.get(id)));
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
  return runTx(db, "sessions", "readonly", async (store) => reqToPromise(store.getAll()));
}

/* ---------- Meta (optional) ---------- */
export async function metaGet(db, key) {
  return runTx(db, "meta", "readonly", async (store) => reqToPromise(store.get(key)));
}
export async function metaSet(db, key, value) {
  return runTx(db, "meta", "readwrite", async (store) => reqToPromise(store.put({ key, value })));
}
export async function wipeAll(db) {
  // Clears zones + sessions + meta
  await runTx(db, "sessions", "readwrite", async (s) => reqToPromise(s.clear()));
  await runTx(db, "zones", "readwrite", async (s) => reqToPromise(s.clear()));
  await runTx(db, "meta", "readwrite", async (s) => reqToPromise(s.clear()));
}

/* ---------- Init ---------- */
export async function initDB() {
  const db = await openDB();

  // Ensure defaults exist & active
  await ensureZone(db, "McKinney");
  await ensureZone(db, "Princeton");
  await ensureZone(db, "Allen");
  await ensureZone(db, "Plano");

  return db;
}

export async function ensureZoneIdByName(db, name) {
  return ensureZone(db, name);
}