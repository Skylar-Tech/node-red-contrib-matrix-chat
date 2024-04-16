const {Phase} = require("matrix-js-sdk/lib/crypto/verification/request/VerificationRequest");
const {CryptoEvent} = require("matrix-js-sdk/lib/crypto");

module.exports = function(RED) {
    const verificationRequests = new Map();

    function MatrixDeviceVerification(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.mode = n.mode;

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }

        if(!node.server.e2ee) {
            node.error("End-to-end encryption needs to be enabled to use this.");
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        function getKeyByValue(object, value) {
            return Object.keys(object).find(key => object[key] === value);
        }

        switch(node.mode) {
            default:
                node.error("Node not configured with a mode");
                break;

            case 'request':
                node.on('input', async function(msg){
                    if(!msg.userId) {
                        node.error("msg.userId is required for start verification mode");
                    }

                    node.server.matrixClient.requestDeviceVerification(msg.userId, msg.devices || undefined)
                        .then(function(e) {
                            node.log("Successfully requested verification", e);
                            let verifyRequestId = msg.userId + ':' + e.channel.deviceId;
                            verificationRequests.set(verifyRequestId, e);
                            node.send({
                                verifyRequestId: verifyRequestId, // internally used to reference between nodes
                                verifyMethods: e.methods,
                                userId: msg.userId,
                                deviceIds: e.channel.devices,
                                selfVerification: e.isSelfVerification,
                                phase: getKeyByValue(Phase, e.phase)
                            });
                        })
                        .catch(function(e){
                            node.warn("Error requesting device verification: " + e);
                            msg.error = e;
                            node.send([null, msg]);
                        });
                });
                break;

            case 'receive':
                /**
                 * Fires when a key verification is requested.
                 * @event module:client~MatrixClient#"crypto.verification.request"
                 * @param {object} data
                 * @param {MatrixEvent} data.event the original verification request message
                 * @param {Array} data.methods the verification methods that can be used
                 * @param {Number} data.timeout the amount of milliseconds that should be waited
                 *                 before cancelling the request automatically.
                 * @param {Function} data.beginKeyVerification a function to call if a key
                 *     verification should be performed.  The function takes one argument: the
                 *     name of the key verification method (taken from data.methods) to use.
                 * @param {Function} data.cancel a function to call if the key verification is
                 *     rejected.
                 */
                node.server.matrixClient.on(CryptoEvent.VerificationRequestReceived, async function(data){
                    if(data.phase === Phase.Cancelled || data.phase === Phase.Done) {
                        return;
                    }

                    if(data.requested || true) {
                        let verifyRequestId = data.targetDevice.userId + ':' + data.targetDevice.deviceId;
                        verificationRequests.set(verifyRequestId, data);
                        node.send({
                            verifyRequestId: verifyRequestId, // internally used to reference between nodes
                            verifyMethods: data.methods,
                            userId: data.targetDevice.userId,
                            deviceId: data.targetDevice.deviceId,
                            selfVerification: data.isSelfVerification,
                            phase: getKeyByValue(Phase, data.phase)
                        });
                    }
                });

                node.on('close', function(done) {
                    // clear verification requests
                    verificationRequests.clear();
                    done();
                });
                break;

            case 'start':
                node.on('input', async function(msg){
                    if(!msg.verifyRequestId || !verificationRequests.has(msg.verifyRequestId)) {
                        node.error("invalid verification request (invalid msg.verifyRequestId): " + (msg.verifyRequestId || null));
                    }

                    var data = verificationRequests.get(msg.verifyRequestId);
                    if(msg.cancel) {
                        await data.verifier.cancel();
                        verificationRequests.delete(msg.verifyRequestId);
                    } else {
                        try {
                            data.on('change', async function() {
                                // VerificationPhase {
                                //     /** Initial state: no event yet exchanged */
                                //     Unsent = 1,
                                //
                                //         /** An `m.key.verification.request` event has been sent or received */
                                //         Requested = 2,
                                //
                                //         /** An `m.key.verification.ready` event has been sent or received, indicating the verification request is accepted. */
                                //         Ready = 3,
                                //
                                //         /** An `m.key.verification.start` event has been sent or received, choosing a verification method */
                                //         Started = 4,
                                //
                                //         /** An `m.key.verification.cancel` event has been sent or received at any time before the `done` event, cancelling the verification request */
                                //         Cancelled = 5,
                                //
                                //         /** An `m.key.verification.done` event has been **sent**, completing the verification request. */
                                //         Done = 6,
                                // }
                                console.log("[Verification Start] VERIFIER EVENT CHANGE", this.phase);
                                var that = this;
                                if(this.phase === Phase.Started) {
                                    console.log("[Verification Start] VERIFIER EVENT PHASE STARTED");
                                    let verifierCancel = function(){
                                        let verifyRequestId = that.targetDevice.userId + ':' + that.targetDevice.deviceId;
                                        if(verificationRequests.has(verifyRequestId)) {
                                            verificationRequests.delete(verifyRequestId);
                                        }
                                    };

                                    data.verifier.on('cancel', function(e){
                                        node.warn("Device verification cancelled " + e);
                                        console.log(JSON.stringify(e.value));
                                        verifierCancel();
                                    });
                                    const sasEventPromise = new Promise(resolve =>
                                        data.verifier.once("show_sas", resolve)
                                    );
                                    console.log("[Verification Start] Starting verification");
                                    data.verifier.verify()
                                        .then(function() {
                                            console.log("[Verification Start] verify() success");
                                        }).catch(function(e) {
                                            console.log("[Verification Start] verify() error", e);
                                            msg.error = e;
                                            node.send([null, msg]);
                                        });
                                    console.log("[Verification Start] WAITING FOR SHOW SAS EVENT");
                                    const sasEvent = await sasEventPromise;

                                    console.log("SHOW SAS", sasEvent);
                                    // e = {
                                    //     sas: {
                                    //         decimal: [ 8641, 3153, 2357 ],
                                    //         emoji: [
                                    //             [Array], [Array],
                                    //             [Array], [Array],
                                    //             [Array], [Array],
                                    //             [Array]
                                    //         ]
                                    //     },
                                    //     confirm: [AsyncFunction: confirm],
                                    //     cancel: [Function: cancel],
                                    //     mismatch: [Function: mismatch]
                                    // }
                                    msg.payload = sasEvent.sas;
                                    msg.emojis = sasEvent.sas.emoji.map(function(emoji, i) {
                                        return emoji[0];
                                    });
                                    msg.emojis_text = sasEvent.sas.emoji.map(function(emoji, i) {
                                        return emoji[1];
                                    });
                                    node.send(msg);

                                    // sasEvent.mismatch();
                                }
                            });

                            console.log("[Verification Start] Starting verification");
                            try {
                                console.log("[Verification Start] Accepting..");
                                await data.accept();
                                console.log(`[Verification] beginKeyVerification (methods=${data.methods[0]}, targetDevice=${data.targetDevice})`);
                                await data.beginKeyVerification(
                                    data.methods[0],
                                    data.targetDevice
                                );
                            } catch(e) {
                                console.log("[Verification Start] VERIFICATION ERROR", e);
                            }
                        } catch(e) {
                            console.log("ERROR", e);
                        }
                    }
                });
                break;

            case 'cancel':
                node.on('input', async function(msg){
                    if(!msg.verifyRequestId || !verificationRequests.has(msg.verifyRequestId)) {
                        node.error("Invalid verification request: " + (msg.verifyRequestId || null));
                    }

                    var data = verificationRequests.get(msg.verifyRequestId);
                    if(data) {
                        data.cancel()
                            .then(function(e){
                                node.send([msg, null]);
                            })
                            .catch(function(e) {
                                msg.error = e;
                                node.send([null, msg]);
                            });
                    }
                });
                break;

            case 'accept':
                node.on('input', async function(msg){
                    if(!msg.verifyRequestId || !verificationRequests.has(msg.verifyRequestId)) {
                        node.error("Invalid verification request: " + (msg.verifyRequestId || null));
                    }

                    var data = verificationRequests.get(msg.verifyRequestId);
                    if(data.verifier && data.verifier.sasEvent) {
                        try {
                            await data.verifier.sasEvent.confirm();
                            node.send([msg, null]);
                        } catch(e) {

                            msg.error = e;
                            node.send([null, msg]);
                        }
                    } else {
                        node.error("Verification must be started");
                    }
                });
                break;
        }
    }
    RED.nodes.registerType("matrix-device-verification", MatrixDeviceVerification);
}