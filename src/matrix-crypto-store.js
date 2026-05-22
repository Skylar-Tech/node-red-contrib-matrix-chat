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

module.exports = { ensureIndexedDBShim, restoreCryptoStore, snapshotCryptoStore };
