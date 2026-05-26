// matrix-js-sdk is an ES module; load it via dynamic import so this CommonJS
// node keeps working. All SDK-dependent setup awaits this promise.
const sdkPromise = import("matrix-js-sdk");
// The crypto-api enums (CryptoEvent, VerificationPhase, ...) are not re-exported
// from the package root, so they are imported from the crypto-api subpath.
const cryptoApiPromise = import("matrix-js-sdk/lib/crypto-api/index.js");

const fs = require("fs-extra");
const { resolve } = require('path');
const { LocalStorage } = require('node-localstorage');
const {
    ensureIndexedDBShim,
    restoreCryptoStore,
    snapshotCryptoStore,
    patchLocalStorageCryptoStoreForRustMigration,
} = require('./matrix-crypto-store');
require("abort-controller/polyfill"); // polyfill abort-controller if we don't have it
if (!globalThis.fetch) {
    // polyfill fetch if we don't have it
    if (!globalThis.fetch) {
        import('node-fetch').then(({ default: fetch, Headers, Request, Response }) => {
            Object.assign(globalThis, { fetch, Headers, Request, Response })
        })
    }
}

/**
 * Resolve the real homeserver base URL for a configured server name / URL.
 *
 * Uses matrix-js-sdk's built-in .well-known auto-discovery: given e.g.
 * "https://example.org" it looks up https://example.org/.well-known/matrix/client
 * and returns the homeserver it delegates to (e.g. https://matrix.example.org).
 * If there is no .well-known delegation (or discovery fails), the original URL
 * is returned unchanged, so explicitly-configured homeserver URLs still work.
 */
async function resolveHomeserverUrl(sdk, configuredUrl) {
    if(!configuredUrl) {
        return configuredUrl;
    }
    let domain;
    try {
        domain = new URL(configuredUrl).host;
    } catch(e) {
        // not a full URL - treat the value itself as a domain
        domain = String(configuredUrl).replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    }
    if(!domain) {
        return configuredUrl;
    }
    try {
        const discovery = await sdk.AutoDiscovery.findClientConfig(domain);
        const homeserver = discovery['m.homeserver'];
        if(homeserver && homeserver.state === sdk.AutoDiscovery.SUCCESS && homeserver.base_url) {
            return homeserver.base_url;
        }
    } catch(e) {
        // discovery failed unexpectedly - fall back to the configured URL
    }
    return configuredUrl;
}

module.exports = function(RED) {
    // disable logging if set to "off"
    let loggingSettings = RED.settings.get('logging');
    if(
        typeof loggingSettings.console !== 'undefined' &&
        typeof loggingSettings.console.level !== 'undefined' &&
        ['info','debug','trace'].indexOf(loggingSettings.console.level.toLowerCase()) >= 0
    ) {
        import('matrix-js-sdk/lib/logger.js')
            .then(({ logger }) => logger.disableAll())
            .catch(() => { /* logger module path changed - ignore */ });
    }

    function MatrixFolderNameFromUserId(name) {
        return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }

    function MatrixServerNode(n) {
        let node = this,
            storageDir = RED.settings.userDir + '/matrix-client-storage';
        RED.nodes.createNode(this, n);
        node.setMaxListeners(1000);

        node.log("Initializing Matrix Server Config node");

        if(!this.credentials) {
            this.credentials = {};
        }

        this.users = {};
        this.connected = null;
        this.name = n.name;
        this.userId = this.credentials.userId;
        this.deviceLabel = this.credentials.deviceLabel || null;
        this.deviceId = this.credentials.deviceId || null;
        this.url = this.credentials.url;
        this.autoAcceptRoomInvites = n.autoAcceptRoomInvites;
        this.e2ee = n.enableE2ee || false;
        // Whether to send encrypted messages to devices that have not been
        // verified. Undefined (config saved before this option existed) keeps
        // the long-standing behaviour of allowing unverified devices.
        this.allowUnknownDevices = n.allowUnknownDevices;
        // Optional account password (used by the login helper, and as fallback
        // user-interactive auth when resetting secure backup / cross-signing).
        this.botPassword = this.credentials.password || null;
        this.globalAccess = n.global;
        this.initializedAt = new Date();
        node.initialSyncLimit = 25;

        // Live device-verification state, shared with the matrix-verification
        // and matrix-verification-action nodes. Keyed by verification id.
        node.verificationRequests = new Map(); // id -> VerificationRequest
        node.verificationSas = new Map();      // id -> ShowSasCallbacks
        // Cached Secure Secret Storage (4S) key as [keyId, Uint8Array], set by
        // the /matrix-chat/secure-backup admin endpoint once unlocked.
        node._secretStorageKeyCache = null;

        // Keep track of all consumers of this node to be able to catch errors
        node.register = function(consumerNode) {
            node.users[consumerNode.id] = consumerNode;
        };
        node.deregister = function(consumerNode) {
            delete node.users[consumerNode.id];
        };

        if(!this.userId) {
            node.log("Matrix connection failed: missing user ID in configuration.");
            return;
        }

        let localStorageDir = storageDir + '/' + MatrixFolderNameFromUserId(this.userId),
            localStorage = new LocalStorage(localStorageDir),
            initialSetup = false;

        let retryStartTimeout = null;

        // Rust crypto persistence (see ./matrix-crypto-store.js). Each Matrix
        // account gets its own IndexedDB name prefix and on-disk snapshot so
        // multiple server-config nodes never collide.
        let cryptoDbPrefix = 'mxjssdk-' + MatrixFolderNameFromUserId(this.userId),
            cryptoSnapshotPath = null,
            cryptoSnapshotInterval = null;

        if(!this.credentials.accessToken) {
            node.error("Matrix connection failed: missing access token in configuration.");
        } else if(!this.url) {
            node.error("Matrix connection failed: missing server URL in configuration.");
        } else {
            node.setConnected = async function(connected, cb) {
                if (node.connected !== connected) {
                    node.connected = connected;
                    if(typeof cb === 'function') {
                        cb(connected);
                    }

                    if (connected) {
                        node.log("Matrix server connection ready.");
                        node.emit("connected");
                        if(!initialSetup) {
                            // store Device ID internally
                            let stored_device_id = getStoredDeviceId(localStorage),
                                device_id = this.matrixClient.getDeviceId();

                            if(!device_id && node.enableE2ee) {
                                node.error("Failed to auto detect deviceId for this auth token. You will need to manually specify one. You may need to login to create a new deviceId.")
                            } else {
                                if(!stored_device_id || stored_device_id !== device_id) {
                                    node.log(`Saving Device ID (old:${stored_device_id} new:${device_id})`);
                                    storeDeviceId(localStorage, device_id);
                                }

                                // update device label
                                if(node.deviceLabel) {
                                    node.matrixClient
                                        .getDevice(device_id)
                                        .then(
                                            function(response) {
                                                if(response.display_name !== node.deviceLabel) {
                                                    node.matrixClient.setDeviceDetails(device_id, {
                                                        display_name: node.deviceLabel
                                                    }).then(
                                                        function(response) {},
                                                        function(error) {
                                                            node.error("Failed to set device label: " + error);
                                                        }
                                                    );
                                                }
                                            },
                                            function(error) {
                                                node.error("Failed to fetch device: " + error);
                                            }
                                        );
                                }
                            }

                            initialSetup = true;
                        }
                    } else {
                        node.emit("disconnected");
                    }

                    if(this.globalAccess) {
                        this.context().global.set('matrixClientOnline["'+this.userId+'"]', connected);
                    }
                }
            };
            node.setConnected(false);

            node.isConnected = function() {
                return node.connected;
            };

            // Snapshot the Rust crypto store to disk so E2EE state survives
            // restarts. No-op when E2EE is disabled.
            async function persistCrypto() {
                if(!cryptoSnapshotPath) {
                    return;
                }
                try {
                    await snapshotCryptoStore(cryptoSnapshotPath, cryptoDbPrefix);
                } catch(e) {
                    node.error("Failed to persist Matrix crypto store: " + e);
                }
            }

            // Discard all persisted crypto state for this account. Used when the
            // device ID changes - the old crypto store belongs to a device that
            // no longer exists and the Rust crypto stack refuses to load it.
            async function discardCryptoStore() {
                // remove the persisted Rust crypto snapshot
                try {
                    if(cryptoSnapshotPath) {
                        fs.removeSync(cryptoSnapshotPath);
                    }
                } catch(e) {
                    node.warn("Could not remove crypto snapshot: " + e);
                }
                // remove legacy (libolm) crypto data from local storage
                try {
                    for(let i = localStorage.length - 1; i >= 0; i--) {
                        let key = localStorage.key(i);
                        if(key && key.indexOf('crypto') === 0) {
                            localStorage.removeItem(key);
                        }
                    }
                } catch(e) {
                    node.warn("Could not clear legacy crypto store: " + e);
                }
                // drop any in-memory IndexedDB database for this account's crypto store
                try {
                    if(globalThis.indexedDB && typeof indexedDB.databases === 'function') {
                        let dbs = await indexedDB.databases();
                        for(let db of dbs) {
                            if(db.name && db.name.indexOf(cryptoDbPrefix) === 0) {
                                await new Promise(function(resolve) {
                                    let req = indexedDB.deleteDatabase(db.name);
                                    req.onsuccess = req.onerror = req.onblocked = function(){ resolve(); };
                                });
                            }
                        }
                    }
                } catch(e) {
                    node.warn("Could not clear in-memory crypto database: " + e);
                }
            }

            function stopClient() {
                if(node.matrixClient && node.matrixClient.clientRunning) {
                    node.matrixClient.stopClient();
                    node.setConnected(false);
                }

                if(retryStartTimeout) {
                    clearTimeout(retryStartTimeout);
                }
                if(cryptoSnapshotInterval) {
                    clearInterval(cryptoSnapshotInterval);
                    cryptoSnapshotInterval = null;
                }
            }

            node.on('close', function(done) {
                stopClient();
                persistCrypto().finally(function() {
                    if(node.globalAccess) {
                        try {
                            node.context().global.set('matrixClient["'+node.userId+'"]', undefined);
                        } catch(e){
                            node.error(e.message);
                        }
                    }
                    done();
                });
            });

            fs.ensureDirSync(storageDir); // create storage directory if it doesn't exist
            upgradeDirectoryIfNecessary(node, storageDir);

            if(node.e2ee) {
                cryptoSnapshotPath = localStorageDir + '/rust-crypto-store.v8';
            }

            setupClient().catch(function(error) {
                node.error(error);
            });

            async function setupClient() {
                const sdk = await sdkPromise;
                const {
                    RelationType, RoomEvent, RoomMemberEvent, HttpApiEvent, ClientEvent,
                    MemoryStore, LocalStorageCryptoStore,
                } = sdk;
                const {
                    CryptoEvent, VerificationRequestEvent, VerifierEvent, VerificationPhase,
                } = await cryptoApiPromise;

                // ---- Device verification ----------------------------------
                // Surface a verification request (and every subsequent phase
                // change) to the matrix-verification node as a "Verification.update"
                // event. Live request objects are kept in node.verificationRequests
                // so the matrix-verification-action node can act on them by id.
                function buildVerificationMsg(request, sasShown) {
                    let phase = sasShown
                        ? 'sas'
                        : String(VerificationPhase[request.phase] || 'unknown').toLowerCase();
                    let msg = {
                        verificationId    : request.transactionId,
                        phase             : phase,
                        payload           : phase,
                        userId            : request.otherUserId,
                        deviceId          : request.otherDeviceId || null,
                        topic             : request.roomId || null,
                        isSelfVerification: request.isSelfVerification,
                        initiatedByMe     : request.initiatedByMe,
                    };
                    // chosenMethod is null until a verification method is picked.
                    // (request.methods is intentionally not used - it is not
                    // implemented in the Rust crypto stack and always throws.)
                    try {
                        msg.chosenMethod = request.chosenMethod || null;
                    } catch(e) {
                        msg.chosenMethod = null;
                    }
                    let sas = node.verificationSas.get(request.transactionId);
                    if(sas && sas.sas) {
                        msg.sas = {
                            emoji  : sas.sas.emoji || null,
                            decimal: sas.sas.decimal || null,
                        };
                    }
                    if(request.phase === VerificationPhase.Cancelled) {
                        msg.cancellationCode = request.cancellationCode || null;
                    }
                    return msg;
                }

                // Emit a verification update. Never lets an exception escape -
                // this runs inside the SDK's synchronous event emission, where an
                // uncaught throw would crash Node-RED.
                function emitVerificationUpdate(request, sasShown) {
                    try {
                        node.emit("Verification.update", buildVerificationMsg(request, sasShown));
                    } catch(e) {
                        node.error("Failed to process verification update: " + e);
                    }
                }

                node.trackVerificationRequest = function(request) {
                    let id;
                    try { id = request.transactionId; } catch(e) { id = undefined; }
                    if(!id) {
                        // transactionId is only assigned once the first event is
                        // sent - wait for it before tracking.
                        const waitForId = function() {
                            let tid;
                            try { tid = request.transactionId; } catch(e) { tid = undefined; }
                            if(tid) {
                                request.off(VerificationRequestEvent.Change, waitForId);
                                node.trackVerificationRequest(request);
                            }
                        };
                        request.on(VerificationRequestEvent.Change, waitForId);
                        return;
                    }
                    if(node.verificationRequests.has(id)) {
                        return; // already tracked
                    }
                    node.verificationRequests.set(id, request);
                    request.__nrSeenAt = Date.now();

                    let verifierHooked = false;
                    const onChange = function() {
                        try {
                            // Once a verifier exists, hook its SAS event so the
                            // emoji/decimal can be surfaced to the flow.
                            const verifier = request.verifier;
                            if(verifier && !verifierHooked) {
                                verifierHooked = true;
                                verifier.on(VerifierEvent.ShowSas, function(sasCallbacks) {
                                    node.verificationSas.set(id, sasCallbacks);
                                    emitVerificationUpdate(request, true);
                                });
                            }
                            emitVerificationUpdate(request, false);
                            if(request.phase === VerificationPhase.Done || request.phase === VerificationPhase.Cancelled) {
                                request.off(VerificationRequestEvent.Change, onChange);
                                // Keep the finished request briefly so the config
                                // editor's verification list can still report the
                                // outcome; the /matrix-chat/verification "list"
                                // action sweeps entries older than 2 minutes.
                                if(!request.__nrEndedAt) {
                                    request.__nrEndedAt = Date.now();
                                }
                            }
                        } catch(e) {
                            node.error("Verification request handler error: " + e);
                        }
                    };
                    request.on(VerificationRequestEvent.Change, onChange);
                    emitVerificationUpdate(request, false);
                };

                // Resolve the real homeserver via .well-known discovery so a
                // delegating domain (e.g. "example.org") works as the server URL.
                const baseUrl = await resolveHomeserverUrl(sdk, node.url);
                if(baseUrl !== node.url) {
                    node.log(`Discovered homeserver ${baseUrl} for ${node.url} via .well-known`);
                }

                let clientOpts = {
                    baseUrl: baseUrl,
                    accessToken: node.credentials.accessToken,
                    store: new MemoryStore({
                        localStorage: localStorage,
                    }),
                    userId: node.userId,
                    deviceId: (node.deviceId || getStoredDeviceId(localStorage)) || undefined,
                    cryptoCallbacks: {
                        // Supplies the Secure Secret Storage (4S) key to the crypto
                        // stack once it has been unlocked via the secure-backup
                        // admin endpoint. Returns null when no key is available.
                        getSecretStorageKey: async function({ keys }) {
                            if(node._secretStorageKeyCache) {
                                const [cachedId, cachedKey] = node._secretStorageKeyCache;
                                if(keys[cachedId]) {
                                    return [cachedId, cachedKey];
                                }
                            }
                            return null;
                        },
                        // Caches a newly created 4S key (e.g. after a reset).
                        cacheSecretStorageKey: function(keyId, keyInfo, key) {
                            node._secretStorageKeyCache = [keyId, key];
                        },
                    },
                };
                if(node.e2ee) {
                    // Provide the legacy (pre-v37 libolm) crypto store so that
                    // initRustCrypto() can perform a one-time migration of any
                    // existing crypto state into the Rust crypto store. Patch
                    // the store because matrix-js-sdk's LocalStorageCryptoStore
                    // omits deviceKey/sessionId from getEndToEndSessionsBatch(),
                    // which breaks the libolm->rust olm-session migration.
                    clientOpts.cryptoStore = patchLocalStorageCryptoStoreForRustMigration(
                        new LocalStorageCryptoStore(localStorage)
                    );
                }
                node.matrixClient = sdk.createClient(clientOpts);

                node.debug(`hasLazyLoadMembersEnabled=${node.matrixClient.hasLazyLoadMembersEnabled()}`);

                // set globally if configured to do so
                if(node.globalAccess) {
                    node.context().global.set('matrixClient["'+node.userId+'"]', node.matrixClient);
                }

                node.matrixClient.on(RoomEvent.Timeline, async function(event, room, toStartOfTimeline, removed, data) {
                    if (toStartOfTimeline) {
                        node.log("Ignoring" + (event.isEncrypted() ? ' encrypted' : '') +" timeline event [" + (event.getContent()['msgtype'] || event.getType()) + "]: (" + room.name + ") " + event.getId() + " for reason: paginated result");
                        return; // ignore paginated results
                    }
                    if (!data || !data.liveEvent) {
                        node.log("Ignoring" + (event.isEncrypted() ? ' encrypted' : '') +" timeline event [" + (event.getContent()['msgtype'] || event.getType()) + "]: (" + room.name + ") " + event.getId() + " for reason: old message");
                        return; // ignore old message (we only want live events)
                    }
                    if(node.initializedAt > event.getDate()) {
                        node.log("Ignoring" + (event.isEncrypted() ? ' encrypted' : '') +" timeline event [" + (event.getContent()['msgtype'] || event.getType()) + "]: (" + room.name + ") " + event.getId() + " for reason: old message before init");
                        return; // skip events that occurred before our client initialized
                    }

                    try {
                        await node.matrixClient.decryptEventIfNeeded(event);
                    } catch (error) {
                        node.error(error);
                        return;
                    }

                    const isDmRoom = (room) => {
                        // Find out if this is a direct message room.
                        let isDM = !!room.getDMInviter();
                        const allMembers = room.currentState.getMembers();
                        if (!isDM && allMembers.length <= 2) {
                            // if not a DM, but there are 2 users only
                            // double check DM (needed because getDMInviter works only if you were invited, not if you invite)
                            // hence why we check for each member
                            if (allMembers.some((m) => m.getDMInviter())) {
                                return true;
                            }
                        }
                        return allMembers.length <= 2 && isDM;
                    };

                    let msg = {
                        encrypted    : event.isEncrypted(),
                        redacted     : event.isRedacted(),
                        content      : event.getContent(),
                        type         : (event.getContent()['msgtype'] || event.getType()) || null,
                        payload      : (event.getContent()['body'] || event.getContent()) || null,
                        isDM         : isDmRoom(room),
                        isThread     : event.getContent()?.['m.relates_to']?.rel_type === RelationType.Thread,
                        mentions     : event.getContent()["m.mentions"] || null,
                        userId       : event.getSender(),
                        user         : node.matrixClient.getUser(event.getSender()),
                        topic        : event.getRoomId(),
                        eventId      : event.getId(),
                        event        : event,
                    };

                    // remove keys from user property that start with an underscore
                    Object.keys(msg.user).forEach(function (key) {
                        if (/^_/.test(key)) {
                            delete msg.user[key];
                        }
                    });

                    node.log(`Received ${msg.encrypted ? 'encrypted ' : ''}timeline event [${msg.type}]: (${room.name}) ${event.getSender()} :: ${msg.content.body} ${toStartOfTimeline ? ' [PAGINATED]' : ''}`);
                    node.emit("Room.timeline", event, room, toStartOfTimeline, removed, data, msg);
                });

                // handle auto-joining rooms
                node.matrixClient.on(RoomMemberEvent.Membership, async function(event, member) {
                    if(node.initializedAt > event.getDate()) {
                        return; // skip events that occurred before our client initialized
                    }

                    if (member.membership === "invite" && member.userId === node.userId) {
                        node.log("Got invite to join room " + member.roomId);
                        if(node.autoAcceptRoomInvites) {
                            node.matrixClient.joinRoom(member.roomId).then(function() {
                                node.log("Automatically accepted invitation to join room " + member.roomId);
                            }).catch(function(e) {
                                node.warn("Cannot join room (could be from being kicked/banned) " + member.roomId + ": " + e);
                            });
                        }

                        let room = node.matrixClient.getRoom(event.getRoomId());
                        node.emit("Room.invite", {
                            type      : 'm.room.member',
                            userId    : event.getSender(),
                            topic     : event.getRoomId(),
                            topicName : (room ? room.name : null) || null,
                            event     : event,
                            eventId   : event.getId(),
                        });
                    }
                });

                node.matrixClient.on(ClientEvent.Sync, async function(state, prevState, data) {
                    node.debug("SYNC [STATE=" + state + "] [PREVSTATE=" + prevState + "]");
                    if(prevState === null && state === "PREPARED" ) {
                        // Occurs when the initial sync is completed first time.
                        // This involves setting up filters and obtaining push rules.
                        node.setConnected(true, function(){
                            node.log("Matrix client connected");
                        });
                    } else if(prevState === null && state === "ERROR") {
                        // Occurs when the initial sync failed first time.
                        node.setConnected(false, function(){
                            node.error("Failed to connect to Matrix server");
                        });
                    } else if(prevState === "ERROR" && state === "PREPARED") {
                        // Occurs when the initial sync succeeds
                        // after previously failing.
                        node.setConnected(true, function(){
                            node.log("Matrix client connected");
                        });
                    } else if(prevState === "PREPARED" && state === "SYNCING") {
                        // Occurs immediately after transitioning to PREPARED.
                        // Starts listening for live updates rather than catching up.
                        node.setConnected(true, function(){
                            node.log("Matrix client connected");
                        });
                    } else if(prevState === "SYNCING" && state === "RECONNECTING") {
                        // Occurs when the live update fails.
                        node.setConnected(false, function(){
                            node.error("Connection to Matrix server lost");
                        });
                    } else if(prevState === "RECONNECTING" && state === "RECONNECTING") {
                        // Can occur if the update calls continue to fail,
                        // but the keepalive calls (to /versions) succeed.
                        node.setConnected(false, function(){
                            node.error("Connection to Matrix server lost");
                        });
                    } else if(prevState === "RECONNECTING" && state === "ERROR") {
                        // Occurs when the keepalive call also fails
                        node.setConnected(false, function(){
                            node.error("Connection to Matrix server lost");
                        });
                    } else if(prevState === "ERROR" && state === "SYNCING") {
                        // Occurs when the client has performed a
                        // live update after having previously failed.
                        node.setConnected(true, function(){
                            node.log("Matrix client connected");
                        });
                    } else if(prevState === "ERROR" && state === "ERROR") {
                        // Occurs when the client has failed to
                        // keepalive for a second time or more.
                        node.setConnected(false, function(){
                            node.error("Connection to Matrix server lost");
                        });
                    } else if(prevState === "SYNCING" && state === "SYNCING") {
                        // Occurs when the client has performed a live update.
                        // This is called <i>after</i> processing.
                        node.setConnected(true, function(){
                            node.log("Matrix client connected");
                        });
                    } else if(state === "STOPPED") {
                        // Occurs once the client has stopped syncing or
                        // trying to sync after stopClient has been called.
                        node.setConnected(false, function(){
                            node.error("Connection to Matrix server lost");
                        });
                    }
                });


                node.matrixClient.on(HttpApiEvent.SessionLoggedOut, async function(errorObj){
                    // Example if user auth token incorrect:
                    // {
                    //     errcode: 'M_UNKNOWN_TOKEN',
                    //     data: {
                    //         errcode: 'M_UNKNOWN_TOKEN',
                    //         error: 'Invalid macaroon passed.',
                    //         soft_logout: false
                    //     },
                    //     httpStatus: 401
                    // }

                    node.error("Authentication failure: " + errorObj);
                    stopClient();
                });

                // incoming device-verification requests from other users/devices
                node.matrixClient.on(CryptoEvent.VerificationRequestReceived, function(request) {
                    try {
                        node.log("Received device verification request from " + request.otherUserId);
                        node.trackVerificationRequest(request);
                    } catch(e) {
                        node.error("Failed to handle incoming verification request: " + e);
                    }
                });

                async function run() {
                    try {
                        if(node.e2ee){
                            node.log("Initializing crypto...");
                            ensureIndexedDBShim();
                            // If the device ID has changed (e.g. a new login), the
                            // persisted crypto store belongs to the old device and
                            // cannot be loaded - discard it and start fresh.
                            // Otherwise restore the previously persisted state.
                            let effectiveDeviceId = node.matrixClient.getDeviceId(),
                                storedDeviceId = getStoredDeviceId(localStorage);
                            if(storedDeviceId && effectiveDeviceId && storedDeviceId !== effectiveDeviceId) {
                                node.warn(`Device ID changed (${storedDeviceId} -> ${effectiveDeviceId}); discarding the encryption store from the old device.`);
                                await discardCryptoStore();
                            } else {
                                await restoreCryptoStore(cryptoSnapshotPath);
                            }
                            await node.matrixClient.initRustCrypto({
                                useIndexedDB: true,
                                cryptoDatabasePrefix: cryptoDbPrefix,
                            });
                            let crypto = node.matrixClient.getCrypto();
                            if(crypto) {
                                // Blacklist (refuse to encrypt to) unverified devices only
                                // when the user has explicitly unticked "Allow unverified
                                // devices". Default/undefined allows them, as before.
                                crypto.globalBlacklistUnverifiedDevices = (node.allowUnknownDevices === false);
                            }
                            // periodically persist crypto state so it survives an unclean shutdown
                            cryptoSnapshotInterval = setInterval(persistCrypto, 5 * 60 * 1000);
                        }
                        node.log("Connecting to Matrix server...");
                        await node.matrixClient.startClient({
                            initialSyncLimit: node.initialSyncLimit
                        });
                    } catch(error) {
                        node.error(error);
                    }
                }

                // do an authed request and only continue if we don't get an error
                // this prevent the matrix client from crashing Node-RED on invalid auth token
                (function checkAuthTokenThenStart() {
                    if(node.matrixClient.clientRunning) {
                        return;
                    }

                    /**
                     * We do a /whoami request before starting for a few reasons:
                     * - validate our auth token
                     * - make sure auth token belongs to provided node.userId
                     * - fetch device_id if possible (only available on Synapse >= v1.40.0 under MSC2033)
                     */
                    node.matrixClient.whoami()
                        .then(
                            function(data) {
                                if((typeof data['device_id'] === undefined || !data['device_id']) && !node.deviceId && !getStoredDeviceId(localStorage)) {
                                    node.error("/whoami request did not return device_id. You will need to manually set one in your configuration because this cannot be automatically fetched.");
                                }
                                if('device_id' in data && data['device_id'] && !node.deviceId) {
                                    // if we have no device_id configured lets use the one
                                    // returned by /whoami for this access_token
                                    node.matrixClient.deviceId = data['device_id'];
                                }

                                // make sure our userId matches the access token's
                                if(data['user_id'].toLowerCase() !== node.userId.toLowerCase()) {
                                    node.error(`User ID provided is ${node.userId} but token belongs to ${data['user_id']}`);
                                    return;
                                }
                                run().catch((error) => node.error(error));
                            },
                            function(err) {
                                // if the error isn't authentication related retry in a little bit
                                if(err.code !== "M_UNKNOWN_TOKEN") {
                                    retryStartTimeout = setTimeout(checkAuthTokenThenStart, 15000);
                                    node.error("Auth check failed: " + err);
                                }
                            }
                        )
                })();
            }
        }
    }

    RED.nodes.registerType("matrix-server-config", MatrixServerNode, {
        credentials: {
            deviceLabel: { type: "text", required: false },
            userId: { type: "text", required: true },
            accessToken: { type: "text", required: true },
            deviceId: { type: "text", required: false },
            url: { type: "text", required: true },
            password: { type: "password", required: false }
        }
    });

    RED.httpAdmin.post(
        "/matrix-chat/login",
        RED.auth.needsPermission('flows.write'),
        async function(req, res) {
            let userId = req.body.userId || undefined,
                password = req.body.password || undefined,
                baseUrl = req.body.baseUrl || undefined,
                deviceId = req.body.deviceId || undefined,
                displayName = req.body.displayName || undefined;

            try {
                const sdk = await sdkPromise;
                // Resolve .well-known delegation so users can enter their domain.
                baseUrl = await resolveHomeserverUrl(sdk, baseUrl);
                const matrixClient = sdk.createClient({
                    baseUrl: baseUrl,
                    deviceId: deviceId,
                    timelineSupport: true,
                    localTimeoutMs: '30000'
                });

                matrixClient.login(
                    'm.login.password', {
                        identifier: {
                            type: 'm.id.user',
                            user: userId,
                        },
                        password: password,
                        initial_device_display_name: displayName
                    })
                    .then(
                        function(response) {
                            res.json({
                                'result': 'ok',
                                'token': response.access_token,
                                'device_id': response.device_id,
                                'user_id': response.user_id,
                            });
                        },
                        function(err) {
                            res.json({
                                'result': 'error',
                                'message': err
                            });
                        }
                    );
            } catch(err) {
                res.json({
                    'result': 'error',
                    'message': err
                });
            }
        });

    /**
     * Interactive Secure Secret Storage (4S) / cross-signing setup for the
     * config editor's "Set up secure backup" button.
     *
     * Secured with the same flows.write permission as the login endpoint, so it
     * is not publicly exposed. Operates on the live, connected client of an
     * already-deployed server configuration node (identified by req.body.id).
     *
     * Actions:
     *  - status : report connection / cross-signing / secret-storage state
     *  - unlock : unlock existing 4S with a recovery key/passphrase, then set up
     *             cross-signing for this device
     *  - reset  : create brand new cross-signing keys and secret storage
     *             (requires the account password); returns the new recovery key
     */
    RED.httpAdmin.post(
        "/matrix-chat/secure-backup",
        RED.auth.needsPermission('flows.write'),
        async function(req, res) {
            try {
                const serverNode = RED.nodes.getNode(req.body.id);
                if(!serverNode || !serverNode.matrixClient) {
                    return res.json({ result: 'error', message: 'Server configuration not found. Save and deploy the server configuration node first.' });
                }
                if(typeof serverNode.isConnected !== 'function' || !serverNode.isConnected()) {
                    return res.json({ result: 'error', message: 'The Matrix client is not connected. Deploy the server configuration and wait for it to connect, then try again.' });
                }
                const crypto = serverNode.matrixClient.getCrypto();
                if(!crypto) {
                    return res.json({ result: 'error', message: 'End-to-end encryption is not enabled on this server configuration.' });
                }
                const secretStorage = serverNode.matrixClient.secretStorage;
                const action = req.body.action || 'status';

                if(action === 'status') {
                    const defaultKeyId = await secretStorage.getDefaultKeyId();
                    return res.json({
                        result: 'ok',
                        crossSigningReady: await crypto.isCrossSigningReady(),
                        secretStorageReady: await crypto.isSecretStorageReady(),
                        secretStorageExists: !!defaultKeyId,
                    });
                }

                if(action === 'unlock') {
                    const cryptoApi = await cryptoApiPromise;
                    const recoveryInput = String(req.body.recoveryKey || '').trim();
                    if(!recoveryInput) {
                        return res.json({ result: 'error', message: 'A recovery key or passphrase is required.' });
                    }
                    const keyId = await secretStorage.getDefaultKeyId();
                    if(!keyId) {
                        return res.json({ result: 'error', message: 'This account has no secure backup to unlock. Use Reset to create one.' });
                    }
                    const stored = await secretStorage.getKey(keyId);
                    const keyInfo = stored && stored[1];
                    if(!keyInfo) {
                        return res.json({ result: 'error', message: 'Could not read the secure backup key description from the account.' });
                    }

                    let keyBytes = null;
                    try {
                        keyBytes = cryptoApi.decodeRecoveryKey(recoveryInput.replace(/\s+/g, ''));
                    } catch(e) { /* not a recovery key - fall back to passphrase */ }
                    if(!keyBytes && keyInfo.passphrase) {
                        keyBytes = await cryptoApi.deriveRecoveryKeyFromPassphrase(
                            recoveryInput, keyInfo.passphrase.salt, keyInfo.passphrase.iterations);
                    }
                    if(!keyBytes) {
                        return res.json({ result: 'error', message: 'Could not read that value as a recovery key or passphrase.' });
                    }
                    if(!(await secretStorage.checkKey(keyBytes, keyInfo))) {
                        return res.json({ result: 'error', message: 'That recovery key / passphrase is not correct.' });
                    }

                    serverNode._secretStorageKeyCache = [keyId, keyBytes];
                    await crypto.bootstrapCrossSigning({
                        authUploadDeviceSigningKeys: async function(makeRequest) {
                            if(req.body.password) {
                                await makeRequest({
                                    type: 'm.login.password',
                                    identifier: { type: 'm.id.user', user: serverNode.userId },
                                    password: req.body.password,
                                });
                            } else {
                                await makeRequest(null);
                            }
                        },
                    });
                    try { await crypto.checkKeyBackupAndEnable(); } catch(e) { /* best effort */ }
                    serverNode.log("Secure backup unlocked; cross-signing set up.");
                    return res.json({
                        result: 'ok',
                        message: 'Secure backup unlocked. Cross-signing is now set up for this bot.',
                        crossSigningReady: await crypto.isCrossSigningReady(),
                    });
                }

                if(action === 'reset') {
                    const password = req.body.password;
                    if(!password) {
                        return res.json({ result: 'error', message: 'The account password is required to reset secure backup.' });
                    }
                    const newKey = await crypto.createRecoveryKeyFromPassphrase();
                    // Replace secret storage FIRST. This makes the new 4S key
                    // (whose private key we hold and cache via cacheSecretStorageKey)
                    // the default before cross-signing is reset. bootstrapCrossSigning
                    // exports the new signing keys into whatever 4S is current, so if
                    // the old 4S were still default it would need the old (unknown)
                    // key and fail with "getSecretStorageKey callback returned falsey".
                    await crypto.bootstrapSecretStorage({
                        setupNewSecretStorage: true,
                        createSecretStorageKey: async function() { return newKey; },
                    });
                    await crypto.bootstrapCrossSigning({
                        setupNewCrossSigning: true,
                        authUploadDeviceSigningKeys: async function(makeRequest) {
                            await makeRequest({
                                type: 'm.login.password',
                                identifier: { type: 'm.id.user', user: serverNode.userId },
                                password: password,
                            });
                        },
                    });
                    serverNode.log("Cross-signing and secure backup were reset.");
                    return res.json({
                        result: 'ok',
                        message: 'Cross-signing and secure backup have been reset. Store the new recovery key somewhere safe - it is shown only once.',
                        recoveryKey: newKey.encodedPrivateKey,
                    });
                }

                return res.json({ result: 'error', message: 'Unknown action: ' + action });
            } catch(error) {
                res.json({ result: 'error', message: String(error && error.message || error) });
            }
        });

    /**
     * Lists and drives device verification requests for the config editor's
     * "Verification" button (the verification list modal). Same flows.write
     * protection as the other admin endpoints, so it is not publicly exposed.
     *
     * Actions (on req.body.id, the server config node):
     *  - list    : the pending verification requests (newest 20)
     *  - advance : accept / start SAS for one request and return its state
     *  - confirm : confirm the SAS emoji match
     *  - mismatch: declare the SAS emoji do not match
     *  - cancel  : cancel the verification
     */
    RED.httpAdmin.post(
        "/matrix-chat/verification",
        RED.auth.needsPermission('flows.write'),
        async function(req, res) {
            try {
                const serverNode = RED.nodes.getNode(req.body.id);
                if(!serverNode || !serverNode.matrixClient) {
                    return res.json({ result: 'error', message: 'Server configuration not found. Save and deploy the server configuration node first.' });
                }
                if(typeof serverNode.isConnected !== 'function' || !serverNode.isConnected()) {
                    return res.json({ result: 'error', message: 'The Matrix client is not connected.' });
                }
                if(!serverNode.matrixClient.getCrypto()) {
                    return res.json({ result: 'error', message: 'End-to-end encryption is not enabled on this server configuration.' });
                }

                const { VerificationPhase } = await cryptoApiPromise;
                const PHASE_NAMES = { 1: 'unsent', 2: 'requested', 3: 'ready', 4: 'started', 5: 'cancelled', 6: 'done' };
                const requests = serverNode.verificationRequests;
                const sasMap = serverNode.verificationSas;
                const action = req.body.action || 'list';

                function safe(fn, fallback) {
                    try { return fn(); } catch(e) { return fallback; }
                }
                function detailOf(vid, r) {
                    const roomId = safe(function(){ return r.roomId; }, null) || null;
                    const timeout = safe(function(){ return r.timeout; }, null);
                    const sas = sasMap.get(vid);
                    return {
                        verificationId    : vid,
                        phase             : PHASE_NAMES[safe(function(){ return r.phase; })] || 'unknown',
                        userId            : safe(function(){ return r.otherUserId; }, null),
                        deviceId          : safe(function(){ return r.otherDeviceId; }, null) || null,
                        roomId            : roomId,
                        type              : roomId ? 'room' : 'device',
                        isSelfVerification: safe(function(){ return r.isSelfVerification; }, false),
                        initiatedByMe     : safe(function(){ return r.initiatedByMe; }, false),
                        ageMs             : Date.now() - (r.__nrSeenAt || Date.now()),
                        expiresInMs       : (typeof timeout === 'number') ? timeout : null,
                        cancellationCode  : safe(function(){ return r.cancellationCode; }, null),
                        sas               : (sas && sas.sas) ? { emoji: sas.sas.emoji || null, decimal: sas.sas.decimal || null } : null,
                    };
                }

                if(action === 'list') {
                    const now = Date.now();
                    // sweep finished verifications kept only for recent lookups
                    for(const entry of Array.from(requests)) {
                        if(entry[1].__nrEndedAt && (now - entry[1].__nrEndedAt) > 120000) {
                            requests.delete(entry[0]);
                            sasMap.delete(entry[0]);
                        }
                    }
                    let items = [];
                    for(const entry of requests) {
                        const detail = detailOf(entry[0], entry[1]);
                        if(detail.phase === 'done' || detail.phase === 'cancelled' || detail.phase === 'unsent') {
                            continue;
                        }
                        items.push(detail);
                    }
                    items.sort(function(a, b) { return a.ageMs - b.ageMs; }); // newest first
                    return res.json({
                        result: 'ok',
                        refreshSeconds: 5,
                        total: items.length,
                        hidden: Math.max(0, items.length - 20),
                        verifications: items.slice(0, 20),
                    });
                }

                // remaining actions operate on a single verification
                const request = requests.get(req.body.verificationId);
                if(!request) {
                    return res.json({ result: 'ok', verification: { verificationId: req.body.verificationId, phase: 'gone' } });
                }

                if(action === 'advance') {
                    try {
                        const phase = safe(function(){ return request.phase; });
                        if(phase === VerificationPhase.Requested
                            && !safe(function(){ return request.initiatedByMe; }, false)
                            && !safe(function(){ return request.accepting; }, false)) {
                            await request.accept();
                        } else if(phase === VerificationPhase.Ready && !safe(function(){ return request.verifier; })) {
                            await request.startVerification("m.sas.v1");
                        }
                        const verifier = safe(function(){ return request.verifier; });
                        if(verifier && !request.__nrVerifyCalled) {
                            request.__nrVerifyCalled = true;
                            verifier.verify().catch(function(){ /* completes/cancels elsewhere */ });
                        }
                    } catch(e) {
                        serverNode.warn("Verification advance error: " + e);
                    }
                    return res.json({ result: 'ok', verification: detailOf(req.body.verificationId, request) });
                }

                if(action === 'confirm' || action === 'mismatch') {
                    const sas = sasMap.get(req.body.verificationId);
                    if(!sas) {
                        return res.json({ result: 'error', message: 'This verification has no SAS awaiting confirmation yet.' });
                    }
                    if(action === 'confirm') {
                        await sas.confirm();
                    } else {
                        sas.mismatch();
                    }
                    return res.json({ result: 'ok', verification: detailOf(req.body.verificationId, request) });
                }

                if(action === 'cancel') {
                    await request.cancel();
                    return res.json({ result: 'ok', verification: detailOf(req.body.verificationId, request) });
                }

                return res.json({ result: 'error', message: 'Unknown action: ' + action });
            } catch(error) {
                res.json({ result: 'error', message: String(error && error.message || error) });
            }
        });

    /**
     * Session (device) management for the config editor's "Sessions" button.
     * Same flows.write protection as the other admin endpoints.
     *
     * Actions (on req.body.id, the server config node):
     *  - list   : the account's sessions (current + others) with verification state
     *  - rename : set a session's display name
     *  - remove : delete a session (requires the account password)
     *  - verify : start verifying a session; returns a verificationId to hand
     *             off to the verification modal
     */
    RED.httpAdmin.post(
        "/matrix-chat/sessions",
        RED.auth.needsPermission('flows.write'),
        async function(req, res) {
            try {
                const serverNode = RED.nodes.getNode(req.body.id);
                if(!serverNode || !serverNode.matrixClient) {
                    return res.json({ result: 'error', message: 'Server configuration not found. Save and deploy the server configuration node first.' });
                }
                if(typeof serverNode.isConnected !== 'function' || !serverNode.isConnected()) {
                    return res.json({ result: 'error', message: 'The Matrix client is not connected.' });
                }
                const client = serverNode.matrixClient;
                const crypto = client.getCrypto();
                if(!crypto) {
                    return res.json({ result: 'error', message: 'End-to-end encryption is not enabled on this server configuration.' });
                }
                const action = req.body.action || 'list';

                if(action === 'list') {
                    const currentDeviceId = client.getDeviceId();
                    const devices = (await client.getDevices()).devices || [];
                    const enriched = await Promise.all(devices.map(async function(d) {
                        let verified = false;
                        try {
                            const status = await crypto.getDeviceVerificationStatus(serverNode.userId, d.device_id);
                            verified = !!(status && status.isVerified());
                        } catch(e) { /* unknown - treat as unverified */ }
                        return {
                            deviceId    : d.device_id,
                            displayName : d.display_name || null,
                            lastSeenTs  : d.last_seen_ts || null,
                            lastSeenIp  : d.last_seen_ip || null,
                            verified    : verified,
                        };
                    }));
                    const current = enriched.find(function(d){ return d.deviceId === currentDeviceId; })
                        || { deviceId: currentDeviceId, displayName: null, lastSeenTs: null, lastSeenIp: null, verified: false };
                    let others = enriched.filter(function(d){ return d.deviceId !== currentDeviceId; });
                    others.sort(function(a, b){ return (b.lastSeenTs || 0) - (a.lastSeenTs || 0); });
                    return res.json({
                        result: 'ok',
                        current: current,
                        others: others.slice(0, 50),
                        hidden: Math.max(0, others.length - 50),
                    });
                }

                const deviceId = req.body.deviceId;
                if(!deviceId) {
                    return res.json({ result: 'error', message: 'A deviceId is required.' });
                }

                if(action === 'rename') {
                    await client.setDeviceDetails(deviceId, { display_name: req.body.displayName || '' });
                    return res.json({ result: 'ok' });
                }

                if(action === 'remove') {
                    const password = req.body.password;
                    try {
                        await client.deleteDevice(deviceId);
                    } catch(e) {
                        // deleting a device is user-interactive-auth protected
                        if(e && e.httpStatus === 401 && e.data && e.data.flows) {
                            if(!password) {
                                return res.json({ result: 'error', message: 'The account password is required to remove a session.' });
                            }
                            await client.deleteDevice(deviceId, {
                                type: 'm.login.password',
                                identifier: { type: 'm.id.user', user: serverNode.userId },
                                password: password,
                                session: e.data.session,
                            });
                        } else {
                            throw e;
                        }
                    }
                    serverNode.log("Removed session " + deviceId);
                    return res.json({ result: 'ok', message: 'Session removed.' });
                }

                if(action === 'verify') {
                    const request = await crypto.requestDeviceVerification(serverNode.userId, deviceId);
                    if(typeof serverNode.trackVerificationRequest === 'function') {
                        serverNode.trackVerificationRequest(request);
                    }
                    return res.json({ result: 'ok', verificationId: request.transactionId || null });
                }

                return res.json({ result: 'error', message: 'Unknown action: ' + action });
            } catch(error) {
                res.json({ result: 'error', message: String(error && error.message || error) });
            }
        });

    function upgradeDirectoryIfNecessary(node, storageDir) {
        let oldStorageDir = './matrix-local-storage',
            oldStorageDir2 = './matrix-client-storage';

        // if the old storage location exists lets move it to the new location
        if(fs.pathExistsSync(oldStorageDir)){
            RED.nodes.eachNode(function(n){
                try {
                    if(n.type !== 'matrix-server-config') return;
                    let { userId } = RED.nodes.getCredentials(n.id);
                    let dir = storageDir + '/' + MatrixFolderNameFromUserId(userId);
                    if(!fs.pathExistsSync(dir)) {
                        fs.ensureDirSync(dir);
                        node.log("found old '" + oldStorageDir + "' path, copying to new location '" + dir);
                        fs.copySync(oldStorageDir, dir);
                    }
                } catch (err) {
                    node.error(err);
                }
            });

            // rename folder to keep as a backup (and so we don't run again)
            node.log("archiving old config folder '" + oldStorageDir + "' to '" + oldStorageDir + "-backup");
            fs.renameSync(oldStorageDir, oldStorageDir + "-backup");
        }

        if(RED.settings.userDir !== resolve('./') && resolve(oldStorageDir2) !== resolve(storageDir)) {
            // user directory does not match running directory
            // check if we stored stuff in wrong directory and move it
            if(fs.pathExistsSync(oldStorageDir2)){
                fs.ensureDirSync(storageDir);
                node.log("found old '" + oldStorageDir2 + "' path, copying to new location '" + storageDir);
                fs.copySync(oldStorageDir2, storageDir);
                // rename folder to keep as a backup (and so we don't run again)
                fs.renameSync(oldStorageDir2, oldStorageDir2 + "-backup");
            }
        }
    }

    /**
     * If a device ID is stored we will use that for the client
     */
    function getStoredDeviceId(localStorage) {
        let deviceId = localStorage.getItem('my_device_id');
        if(deviceId === "null" || !deviceId) {
            return null;
        }
        return deviceId;
    }

    function storeDeviceId(localStorage, deviceId) {
        if(!deviceId) {
            return false;
        }
        localStorage.setItem('my_device_id', deviceId);
        return true;
    }
}
