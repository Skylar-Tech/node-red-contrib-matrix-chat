module.exports = function(RED) {
    function MatrixVerificationAction(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.mode = n.mode || "accept";

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        if (!node.server) {
            node.error("No configuration node");
            return;
        }
        node.server.register(node);

        node.server.on("disconnected", function() {
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });
        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on("input", async function(msg) {
            if (!node.server || !node.server.matrixClient) {
                msg.error = "No matrix server selected";
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            if (!node.server.isConnected()) {
                msg.error = "Matrix server connection is currently closed";
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            const crypto = node.server.matrixClient.getCrypto();
            if (!crypto) {
                msg.error = "End-to-end encryption is not enabled on the Matrix server config";
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            // msg.mode overrides the node's configured mode if provided
            const mode = msg.mode || node.mode;

            try {
                if (mode === "request") {
                    // Start a new verification request.
                    //  - msg.userId + msg.deviceId : verify a specific device (to-device)
                    //  - msg.userId + msg.topic    : verify a user in a DM room
                    //  - otherwise                 : verify our own other devices
                    let request;
                    if (msg.userId && msg.deviceId) {
                        request = await crypto.requestDeviceVerification(msg.userId, msg.deviceId);
                    } else if (msg.userId && msg.topic) {
                        request = await crypto.requestVerificationDM(msg.userId, msg.topic);
                    } else {
                        request = await crypto.requestOwnUserVerification();
                    }

                    if (typeof node.server.trackVerificationRequest === "function") {
                        node.server.trackVerificationRequest(request);
                    }
                    msg.verificationId = request.transactionId;
                    node.send([msg, null]);
                    return;
                }

                // Every other mode acts on an existing tracked request.
                const request = node.server.verificationRequests.get(msg.verificationId);
                if (!request) {
                    throw new Error(`No active verification found for msg.verificationId '${msg.verificationId}'`);
                }

                switch (mode) {
                    case "accept":
                        await request.accept();
                        break;

                    case "start": {
                        // Begin SAS (emoji) verification. The SAS emoji is delivered
                        // through the matrix-verification node when it becomes ready.
                        let verifier = request.verifier;
                        if (!verifier) {
                            verifier = await request.startVerification("m.sas.v1");
                        }
                        verifier.verify().catch(function(e) {
                            node.warn("Verification ended: " + e);
                        });
                        break;
                    }

                    case "confirm": {
                        const sas = node.server.verificationSas.get(msg.verificationId);
                        if (!sas) {
                            throw new Error("This verification has no SAS awaiting confirmation");
                        }
                        await sas.confirm();
                        break;
                    }

                    case "mismatch": {
                        const sas = node.server.verificationSas.get(msg.verificationId);
                        if (!sas) {
                            throw new Error("This verification has no SAS awaiting confirmation");
                        }
                        sas.mismatch();
                        break;
                    }

                    case "cancel":
                        await request.cancel();
                        break;

                    default:
                        throw new Error("Unknown verification action mode: " + mode);
                }

                msg.verificationId = request.transactionId;
                node.send([msg, null]);
            } catch (e) {
                msg.error = String(e && e.message || e);
                node.error("Verification action failed: " + msg.error, msg);
                node.send([null, msg]);
            }
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-verification-action", MatrixVerificationAction);
}
