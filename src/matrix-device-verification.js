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

                    node.server.matrixClient.requestVerification(msg.userId, msg.devices || null)
                        .then(function(e) {
                            node.log("Successfully requested verification");
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
                node.server.matrixClient.on(CryptoEvent.VerificationRequest, async function(data){
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
                        // if(msg.userId && msg.deviceId) {
                        //     node.server.beginKeyVerification("m.sas.v1", msg.userId, msg.deviceId);
                        // }

                        node.error("invalid verification request (invalid msg.verifyRequestId): " + (msg.verifyRequestId || null));
                    }

                    var data = verificationRequests.get(msg.verifyRequestId);
                    if(msg.cancel) {
                        await data._verifier.cancel();
                        verificationRequests.delete(msg.verifyRequestId);
                    } else {
                        try {
                            data.on('change', async function() {
                                var that = this;
                                if(this.phase === Phase.Started) {
                                    let verifierCancel = function(){
                                        let verifyRequestId = that.targetDevice.userId + ':' + that.targetDevice.deviceId;
                                        if(verificationRequests.has(verifyRequestId)) {
                                            verificationRequests.delete(verifyRequestId);
                                        }
                                    };

                                    data._verifier.on('cancel', function(e){
                                        node.warn("Device verification cancelled " + e);
                                        verifierCancel();
                                    });

                                    let show_sas = function(e) {
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
                                        msg.payload = e.sas;
                                        msg.emojis = e.sas.emoji.map(function(emoji, i) {
                                            return emoji[0];
                                        });
                                        msg.emojis_text = e.sas.emoji.map(function(emoji, i) {
                                            return emoji[1];
                                        });
                                        node.send(msg);
                                    };
                                    data._verifier.on('show_sas', show_sas);
                                    data._verifier.verify()
                                        .then(function(e){
                                            data._verifier.off('show_sas', show_sas);
                                            data._verifier.done();
                                        }, function(e) {
                                            verifierCancel();
                                            node.warn(e);
                                            // @todo return over second output
                                        });
                                }
                            });

                            data.emit("change");
                            await data.accept();
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
                    if(data._verifier && data._verifier.sasEvent) {
                        data._verifier.sasEvent.confirm()
                            .then(function(e){
                                node.send([msg, null]);
                            })
                            .catch(function(e) {
                                msg.error = e;
                                node.send([null, msg]);
                            });
                    } else {
                        node.error("Verification must be started");
                    }
                });
                break;
        }
    }
    RED.nodes.registerType("matrix-device-verification", MatrixDeviceVerification);
}