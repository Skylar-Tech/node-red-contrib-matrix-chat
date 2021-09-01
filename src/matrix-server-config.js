global.Olm = require('olm');

module.exports = function(RED) {
    const sdk = require("matrix-js-sdk");
    const { LocalStorage } = require('node-localstorage');
    const localStorage = new LocalStorage('./matrix-local-storage');
    const { LocalStorageCryptoStore } = require('matrix-js-sdk/lib/crypto/store/localStorage-crypto-store');

    function MatrixServerNode(n) {
        // we should add support for getting access token automatically from username/password
        // ref: https://matrix.org/docs/guides/usage-of-the-matrix-js-sdk#login-with-an-access-token

        RED.nodes.createNode(this, n);

        let node = this;
        node.log("Initializing Matrix Server Config node");

        if(!this.credentials) {
            this.credentials = {};
        }

        node.setMaxListeners(1000);

        this.connected = false;
        this.name = n.name;
        this.userId = this.credentials.userId;
        this.deviceId = this.credentials.deviceId || null;
        this.url = this.credentials.url;
        this.autoAcceptRoomInvites = n.autoAcceptRoomInvites;
        this.enableE2ee = n.enableE2ee || false;
        this.e2ee = (this.enableE2ee && this.deviceId);

        if(!this.credentials.accessToken) {
            node.log("Matrix connection failed: missing access token.");
        } else if(!this.url) {
            node.log("Matrix connection failed: missing server URL.");
        } else if(!this.userId) {
            node.log("Matrix connection failed: missing user ID.");
        } else {
            node.matrixClient = sdk.createClient({
                baseUrl: this.url,
                accessToken: this.credentials.accessToken,
                sessionStore: new sdk.WebStorageSessionStore(localStorage),
                cryptoStore: new LocalStorageCryptoStore(localStorage),
                userId: this.userId,
                deviceId: this.deviceId || undefined,
            });

            node.on('close', function(done) {
                if(node.matrixClient) {
                    node.matrixClient.close();
                    node.matrixClient.stopClient();
                    node.setConnected(false);
                }

                done();
            });

            node.setConnected = function(connected) {
                if (node.connected !== connected) {
                    node.connected = connected;
                    if (connected) {
                        node.log("Matrix server connection ready.");
                        node.emit("connected");
                    } else {
                        node.emit("disconnected");
                    }
                }
            };

            node.isConnected = function() {
                return node.connected;
            };

            node.matrixClient.on("Room.timeline", async function(event, room, toStartOfTimeline, data) {
                node.emit("Room.timeline", event, room, toStartOfTimeline, data);
            });

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
            node.matrixClient.on("RoomMember.membership", async function(event, member) {
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

            node.matrixClient.on("sync", async function(state, prevState, data) {
                switch (state) {
                    case "ERROR":
                        node.error("Connection to Matrix server lost");
                        node.setConnected(false);
                        break;

                    case "RECONNECTING":
                    case "STOPPED":
                        node.setConnected(false);
                        break;

                    case "SYNCING":
                        break;

                    case "PREPARED":
                        node.setConnected(true);
                        break;

                    // case "PREPARED":
                    //     // the client instance is ready to be queried.
                    //     node.log("Matrix server connection ready.");
                    //     node.setConnected(true);
                    //     break;
                }
            });

            node.matrixClient.on("Session.logged_out", async function(errorObj){
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

                node.error("[Session.logged_out] " + errorObj);
            });

            async function run() {
                if(node.e2ee){
                    const initCrypto = ms => new Promise(res => node.matrixClient.initCrypto());
                    try {
                        await initCrypto();
                    } catch(error){
                        node.error(error);
                    }
                    node.matrixClient.setGlobalErrorOnUnknownDevices(false);
                }

                const startClient = ms => new Promise(res => node.matrixClient.startClient({ initialSyncLimit: 8 }));
                try {
                    await startClient();
                } catch(error){
                    node.error(error);
                }
            }

            node.log("Connecting to Matrix server...");
            run().catch((error) => node.error(error));
        }
    }

    RED.nodes.registerType("matrix-server-config", MatrixServerNode, {
        credentials: {
            userId: { type:"text", required: true },
            accessToken: { type:"text", required: true },
            deviceId: { type: "text", required: true },
            url: { type: "text", required: true },
        }
    });
}