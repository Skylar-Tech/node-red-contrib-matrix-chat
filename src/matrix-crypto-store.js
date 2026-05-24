/**
 * Persistence helpers for the matrix-js-sdk Rust crypto store in Node.js.
 *
 * matrix-js-sdk v37+ removed the legacy (libolm) crypto stack. The Rust crypto
 * replacement persists its state (device identity, Olm/megolm sessions, etc.)
 * to IndexedDB, which does not exist in Node.js. We provide an in-memory
 * IndexedDB via `fake-indexeddb` and snapshot the databases to/from disk so the
 * crypto state survives Node-RED restarts.
 *
 * The `indexeddbshim` package (which can persist to disk directly) is not used
 * because it is incompatible with the Rust crypto store migrations
 * (see matrix-org/matrix-sdk-crypto-wasm#195). `fake-indexeddb` is spec
 * compliant, so snapshotting it through the public IndexedDB API is reliable.
 */
const fs = require('fs-extra');
const v8 = require('v8');

let shimInstalled = false;

// Mirrors matrix-js-sdk's localStorage-crypto-store.js: olm sessions live under
// "crypto.sessions/<deviceKey>" and migration batches are capped at 50.
const E2E_PREFIX = 'crypto.';
const SESSION_KEY_PREFIX = E2E_PREFIX + 'sessions/';
const SESSION_BATCH_SIZE = 50;
const OLM_BATCH_PATCH_MARKER = Symbol.for('node-red-contrib-matrix-chat.olmSessionBatchPatched');

/**
 * Install the in-memory IndexedDB shim onto globalThis. Idempotent. Must be
 * called before MatrixClient.initRustCrypto().
 */
function ensureIndexedDBShim() {
    if (shimInstalled || globalThis.indexedDB) {
        shimInstalled = true;
        return;
    }
    // `fake-indexeddb/auto` assigns indexedDB / IDBKeyRange / etc. onto globalThis.
    require('fake-indexeddb/auto');
    shimInstalled = true;
}

function reqAsync(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
}

/**
 * Restore previously snapshotted IndexedDB databases from `filePath` into the
 * in-memory store. No-op if the snapshot does not exist. Databases that are
 * already present in memory (e.g. after a Node-RED redeploy that kept the
 * process alive) are left untouched so the live state is not clobbered.
 *
 * Must be called before MatrixClient.initRustCrypto().
 *
 * @returns {Promise<boolean>} true if at least one database was restored.
 */
async function restoreCryptoStore(filePath) {
    ensureIndexedDBShim();

    if (!filePath || !fs.pathExistsSync(filePath)) {
        return false;
    }

    let databases;
    try {
        databases = v8.deserialize(fs.readFileSync(filePath));
    } catch (e) {
        // Corrupt/unreadable snapshot - start fresh rather than crash.
        return false;
    }
    if (!Array.isArray(databases) || !databases.length) {
        return false;
    }

    const existing = new Set((await indexedDB.databases()).map((d) => d.name));
    let restored = 0;

    for (const dbSpec of databases) {
        if (existing.has(dbSpec.name)) {
            continue; // already live in memory - don't overwrite
        }

        const openReq = indexedDB.open(dbSpec.name, dbSpec.version);
        openReq.onupgradeneeded = () => {
            const db = openReq.result;
            for (const store of dbSpec.stores) {
                if (db.objectStoreNames.contains(store.name)) {
                    continue;
                }
                const os = db.createObjectStore(store.name, {
                    keyPath: store.keyPath || undefined,
                    autoIncrement: store.autoIncrement,
                });
                for (const ix of store.indexes) {
                    os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
                }
            }
        };
        const db = await reqAsync(openReq);

        for (const store of dbSpec.stores) {
            if (!store.values.length) {
                continue;
            }
            const tx = db.transaction(store.name, 'readwrite');
            const os = tx.objectStore(store.name);
            for (let i = 0; i < store.values.length; i++) {
                if (store.keyPath) {
                    os.put(store.values[i]);
                } else {
                    os.put(store.values[i], store.keys[i]);
                }
            }
            await txDone(tx);
        }
        db.close();
        restored++;
    }

    return restored > 0;
}

/**
 * Snapshot IndexedDB databases to `filePath`. If `dbNamePrefix` is given only
 * databases whose name starts with it are written, so multiple Matrix accounts
 * sharing one process do not snapshot each other's data.
 *
 * The write is atomic (temp file + rename). Values are serialized with the V8
 * serializer so typed arrays / Maps inside the crypto store survive intact.
 *
 * @returns {Promise<boolean>} true if a snapshot file was written.
 */
async function snapshotCryptoStore(filePath, dbNamePrefix) {
    if (!filePath || !globalThis.indexedDB || typeof indexedDB.databases !== 'function') {
        return false;
    }

    let dbList = await indexedDB.databases();
    if (dbNamePrefix) {
        dbList = dbList.filter((d) => typeof d.name === 'string' && d.name.startsWith(dbNamePrefix));
    }

    const out = [];
    for (const { name, version } of dbList) {
        const db = await reqAsync(indexedDB.open(name, version));
        const stores = [];
        for (const storeName of Array.from(db.objectStoreNames)) {
            const tx = db.transaction(storeName, 'readonly');
            const os = tx.objectStore(storeName);
            const indexes = Array.from(os.indexNames).map((n) => {
                const ix = os.index(n);
                return { name: n, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry };
            });
            stores.push({
                name: storeName,
                keyPath: os.keyPath,
                autoIncrement: os.autoIncrement,
                indexes,
                values: await reqAsync(os.getAll()),
                keys: await reqAsync(os.getAllKeys()),
            });
        }
        db.close();
        out.push({ name, version, stores });
    }

    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, v8.serialize(out));
    fs.renameSync(tmp, filePath);
    return true;
}

/**
 * Patch a LocalStorageCryptoStore instance so its getEndToEndSessionsBatch()
 * returns olm sessions with deviceKey/sessionId attached.
 *
 * Why: matrix-js-sdk's LocalStorageCryptoStore stores olm sessions as
 * `{ session, lastReceivedMessageTs }` with the curve25519 deviceKey encoded
 * only in the localStorage key ("crypto.sessions/<deviceKey>"). On read,
 * getEndToEndSessionsBatch() returns the bare session value without injecting
 * the deviceKey or sessionId, so initRustCrypto()'s libolm-to-rust migration
 * crashes at PickledSession.senderKey = session.deviceKey (undefined). The
 * IndexedDB backend stores those fields in the record and is unaffected.
 *
 * Idempotent and safe to call on a store with no legacy sessions.
 */
function patchLocalStorageCryptoStoreForRustMigration(cryptoStore) {
    if (!cryptoStore || cryptoStore[OLM_BATCH_PATCH_MARKER]) {
        return cryptoStore;
    }
    const store = cryptoStore.store;
    if (!store || typeof store.length !== 'number' || typeof store.key !== 'function') {
        return cryptoStore;
    }
    cryptoStore.getEndToEndSessionsBatch = async function() {
        const result = [];
        for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (!key || !key.startsWith(SESSION_KEY_PREFIX)) {
                continue;
            }
            const deviceKey = key.slice(SESSION_KEY_PREFIX.length);
            let sessions;
            try {
                const raw = store.getItem(key);
                sessions = raw ? JSON.parse(raw) : null;
            } catch (e) {
                sessions = null;
            }
            if (!sessions || typeof sessions !== 'object') {
                continue;
            }
            for (const [sessionId, val] of Object.entries(sessions)) {
                if (val === null || val === undefined) {
                    continue;
                }
                // Mirrors LocalStorageCryptoStore._getEndToEndSessions: very old
                // entries were stored as bare base64 pickle strings.
                const sessionInfo = (typeof val === 'string')
                    ? { session: val, lastReceivedMessageTs: 0 }
                    : val;
                result.push({ ...sessionInfo, deviceKey, sessionId });
                if (result.length >= SESSION_BATCH_SIZE) {
                    return result;
                }
            }
        }
        return result.length === 0 ? null : result;
    };
    cryptoStore[OLM_BATCH_PATCH_MARKER] = true;
    return cryptoStore;
}

module.exports = {
    ensureIndexedDBShim,
    restoreCryptoStore,
    snapshotCryptoStore,
    patchLocalStorageCryptoStoreForRustMigration,
};
