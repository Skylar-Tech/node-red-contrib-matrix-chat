module.exports = function(RED) {
    let sdk = require("matrix-js-sdk");

    function MatrixServerNode(n) {
        // we should add support for getting access token automatically from username/password
        // ref: https://matrix.org/docs/guides/usage-of-the-matrix-js-sdk#login-with-an-access-token

        RED.nodes.createNode(this, n);

        let node = this;
        node.log("Initializing Matrix Server Config node");

        if(!this.credentials) {
            this.credentials = {};
        }

        this.connected = false;
        this.name = n.name;
        this.userId = this.credentials.userId;
        this.url = this.credentials.url;
        this.autoAcceptRoomInvites = n.autoAcceptRoomInvites;

        if(!this.credentials.accessToken) {
            node.log("Matrix connection failed: missing access token.");
        } else if(!this.url) {
            node.log("Matrix connection failed: missing server URL.");
        } else if(!this.userId) {
            node.log("Matrix connection failed: missing user ID.");
        } else {
            node.log("Initializing Matrix Server Config node");

            node.matrixClient = sdk.createClient({
                baseUrl: this.url,
                accessToken: this.credentials.accessToken,
                userId: this.userId
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
                        node.emit("connected");
                    } else {
                        node.emit("disconnected");
                    }
                }
            };

            node.isConnected = function() {
                return node.connected;
            };

            // handle auto-joining rooms
            node.matrixClient.on("RoomMember.membership", function(event, member) {
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

            node.matrixClient.on("sync", function(state, prevState, data) {
                switch (state) {
                    case "ERROR":
                        node.error("Connection to Matrix server lost");
                        console.log(state, prevState, data);
                        node.setConnected(false);
                        break;

                    case "STOPPED":
                        node.setConnected(false);
                        break;

                    case "SYNCING":
                        node.setConnected(true);
                        break;

                    case "PREPARED":
                        // the client instance is ready to be queried.
                        node.log("Matrix server connection ready.");
                        node.setConnected(true);
                        break;
                }
            });

            node.log("Connecting to Matrix server...");
            node.matrixClient.startClient();
        }
    }

    RED.nodes.registerType("matrix-server-config", MatrixServerNode, {
        credentials: {
            userId: { type:"text", required: true },
            accessToken: { type:"text", required: true },
            url: { type: "text", required: true },
        }
    });
}