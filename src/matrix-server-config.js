global.Olm = require('olm');
const fs = require("fs-extra");
const sdk = require("matrix-js-sdk");
const { resolve } = require('path');
const { LocalStorage } = require('node-localstorage');
const { LocalStorageCryptoStore } = require('matrix-js-sdk/lib/crypto/store/localStorage-crypto-store');
const {RoomEvent, RoomMemberEvent, HttpApiEvent, ClientEvent} = require("matrix-js-sdk");
const {deriveKey} = require("matrix-js-sdk/lib/crypto/key_passphrase");
const {encryptAES} = require("matrix-js-sdk/lib/crypto/aes");

module.exports = function(RED) {
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

        this.connected = null;
        this.name = n.name;
        this.userId = this.credentials.userId;
        this.deviceLabel = this.credentials.deviceLabel || null;
        this.deviceId = this.credentials.deviceId || null;
        this.secretStoragePassphrase = this.credentials.secretStoragePassphrase || null;
        this.url = this.credentials.url;
        this.autoAcceptRoomInvites = n.autoAcceptRoomInvites;
        this.e2ee = this.enableE2ee = n.enableE2ee || false;

        this.globalAccess = n.global;
        this.initializedAt = new Date();
        
        if(!this.userId) {
            node.log("Matrix connection failed: missing user ID in configuration.");
            return;
        }

        let cryptoCallbacks = undefined;
        if(node.enableE2ee && node.secretStoragePassphrase && false) {
            // cryptoCallbacks = {
            //     getSecretStorageKey: async function({ keys }, name) {
            //         const ZERO_STR = "\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0";
            //         for (const [keyName, keyInfo] of Object.entries(keys)) {
            //             const key = await deriveKey(node.secretStoragePassphrase, keyInfo.passphrase.salt, keyInfo.passphrase.iterations);
            //             // const key = Uint8Array.of(36, 47, 159, 193, 29, 188, 180, 86, 189, 180, 207, 101, 79, 255, 93, 159, 228, 43, 160, 158, 98, 209, 84, 196, 137, 122, 119, 118, 11, 131, 75, 87);
            //             const { mac } = await encryptAES(ZERO_STR, key, "", keyInfo.iv);
            //             if (keyInfo.mac.replace(/=+$/g, '') === mac.replace(/=+$/g, '')) {
            //                 return [keyName, key];
            //             }
            //         }
            //         return null;
            //     },
            //     async getDehydrationKey() {
            //         return node.secretStoragePassphrase;
            //     },
            //     async generateDehydrationKey() {
            //         return {key: node.secretStoragePassphrase};
            //     }
            // };

            cryptoCallbacks = {
                getSecretStorageKey: async ({ keys }) => {
                    const backupPassphrase = node.secretStoragePassphrase;
                    if (!backupPassphrase) {
                        node.WARN("Missing secret storage key");
                        return null;
                    }
                    let keyId = await node.matrixClient.getDefaultSecretStorageKeyId();
                    if (keyId && !keys[keyId]) {
                        keyId = undefined;
                    }
                    if (!keyId) {
                        keyId = keys[0][0];
                    }
                    const backupInfo = await node.matrixClient.getKeyBackupVersion();
                    const key = await node.matrixClient.keyBackupKeyFromPassword(
                        backupPassphrase,
                        backupInfo
                    );
                    return [keyId, key];
                },
            }
        }

        let localStorageDir = storageDir + '/' + MatrixFolderNameFromUserId(this.userId),
            localStorage = new LocalStorage(localStorageDir),
            initialSetup = false;

        let retryStartTimeout = null;

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
                            if(node.enableE2ee && node.secretStoragePassphrase && !await node.matrixClient.isCrossSigningReady() && false) {
                                // bootstrap cross-signing
                                await node.matrixClient.bootstrapCrossSigning({
                                    // maybe we can skip this?
                                    authUploadDeviceSigningKeys: () => {
                                        return true;
                                    }
                                });
                            }

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

            fs.ensureDirSync(storageDir); // create storage directory if it doesn't exist
            upgradeDirectoryIfNecessary(node, storageDir);
            node.matrixClient = sdk.createClient({
                baseUrl: this.url,
                accessToken: this.credentials.accessToken,
                sessionStore: new sdk.WebStorageSessionStore(localStorage),
                cryptoStore: new LocalStorageCryptoStore(localStorage),
                userId: this.userId,
                deviceId: (this.deviceId || getStoredDeviceId(localStorage)) || undefined,
                verificationMethods: ["m.sas.v1"],
                cryptoCallbacks: cryptoCallbacks
            });

            // set globally if configured to do so
            if(this.globalAccess) {
                this.context().global.set('matrixClient["'+this.userId+'"]', node.matrixClient);
            }

            function stopClient() {
                if(node.matrixClient && node.matrixClient.clientRunning) {
                    node.matrixClient.stopClient();
                    node.setConnected(false);
                }

                if(retryStartTimeout) {
                    clearTimeout(retryStartTimeout);
                }
            }

            node.on('close', function(done) {
                stopClient();
                done();
            });

            node.isConnected = function() {
                return node.connected;
            };

            node.matrixClient.on(RoomEvent.Timeline, async function(event, room, toStartOfTimeline, removed, data) {
                if (toStartOfTimeline) {
                    return; // ignore paginated results
                }
                if (!event.getSender() || event.getSender() === node.userId) {
                    return; // ignore our own messages
                }
                if (!data || !data.liveEvent) {
                    return; // ignore old message (we only want live events)
                }
                if(node.initializedAt > event.getDate()) {
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
                    encrypted : event.isEncrypted(),
                    redacted  : event.isRedacted(),
                    content   : event.getContent(),
                    type      : (event.getContent()['msgtype'] || event.getType()) || null,
                    payload   : (event.getContent()['body'] || event.getContent()) || null,
                    isDM      : isDmRoom(room),
                    userId    : event.getSender(),
                    topic     : event.getRoomId(),
                    eventId   : event.getId(),
                    event     : event
                };

                node.log("Received" + (msg.encrypted ? ' encrypted' : '') +" timeline event [" + msg.type + "]: (" + room.name + ") " + event.getSender() + " :: " + msg.content.body + (toStartOfTimeline ? ' [PAGINATED]' : ''));
                node.emit("Room.timeline", event, room, toStartOfTimeline, removed, data, msg);
            });

            /**
             * Fires when we want to suggest to the user that they restore their megolm keys
             * from backup or by cross-signing the device.
             *
             * @event module:client~MatrixClient#"crypto.suggestKeyRestore"
             */
            // node.matrixClient.on("crypto.suggestKeyRestore", function(){
            //
            // });

            // node.matrixClient.on("RoomMember.typing", async function(event, member) {
            //     let isTyping = member.typing;
            //     let roomId = member.roomId;
            // });

            // node.matrixClient.on("RoomMember.powerLevel", async function(event, member) {
            //     let newPowerLevel = member.powerLevel;
            //     let newNormPowerLevel = member.powerLevelNorm;
            //     let roomId = member.roomId;
            // });

            // node.matrixClient.on("RoomMember.name", async function(event, member) {
            //     let newName = member.name;
            //     let roomId = member.roomId;
            // });

            // handle auto-joining rooms

            node.matrixClient.on(RoomMemberEvent.Membership, async function(event, member) {
                if (member.membership === "invite" && member.userId === node.userId) {
                    if(node.autoAcceptRoomInvites) {
                        node.matrixClient.joinRoom(member.roomId).then(function() {
                            node.log("Automatically accepted invitation to join room " + member.roomId);
                        }).catch(function(e) {
                            node.warn("Cannot join room (could be from being kicked/banned) " + member.roomId + ": " + e);
                        });
                    } else {
                        node.log("Got invite to join room " + member.roomId);
                    }
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

            async function run() {
                try {
                    if(node.e2ee){
                        node.log("Initializing crypto...");
                        await node.matrixClient.initCrypto();
                        node.matrixClient.setGlobalErrorOnUnknownDevices(false);
                    }
                    node.log("Connecting to Matrix server...");
                    await node.matrixClient.startClient({
                        initialSyncLimit: 8
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

    RED.nodes.registerType("matrix-server-config", MatrixServerNode, {
        credentials: {
            deviceLabel: { type: "text", required: false },
            userId: { type: "text", required: true },
            accessToken: { type: "text", required: true },
            deviceId: { type: "text", required: false },
            url: { type: "text", required: true }
        }
    });

    RED.httpAdmin.post(
        "/matrix-chat/login",
        RED.auth.needsPermission('flows.write'),
        function(req, res) {
            let userId = req.body.userId || undefined,
                password = req.body.password || undefined,
                baseUrl = req.body.baseUrl || undefined,
                deviceId = req.body.deviceId || undefined,
                displayName = req.body.displayName || undefined;

            const matrixClient = sdk.createClient({
                baseUrl: baseUrl,
                deviceId: deviceId,
                localTimeoutMs: '30000'
            });

            matrixClient.login(
                'm.login.password', {
                    user: userId,
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
        });

    function upgradeDirectoryIfNecessary(node, storageDir) {
        let oldStorageDir = './matrix-local-storage',
            oldStorageDir2 = './matrix-client-storage';

        // if the old storage location exists lets move it to it's new location
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
                    console.error(err)
                }
            });

            // rename folder to keep as a backup (and so we don't run again)
            node.log("archiving old config folder '" + oldStorageDir + "' to '" + oldStorageDir + "-backup");
            fs.renameSync(oldStorageDir, oldStorageDir + "-backup");
        }

        if(RED.settings.userDir !== resolve('./')) {
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