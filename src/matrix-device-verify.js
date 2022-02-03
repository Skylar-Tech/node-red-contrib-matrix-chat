module.exports = function(RED) {
    const verificationRequests = new Map();

    function MatrixDeviceVerifyRequest(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

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
        node.server.matrixClient.on("crypto.verification.request", async function(data){
            console.log("[######### crypto.verification.request #########]", data.phase, data);

            if(data.phase === 5 || data.phase === 6) {
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
                    type: 'crypto.verification.request',
                    selfVerification: data.isSelfVerification
                });
            }
        });
    }
    RED.nodes.registerType("matrix-device-verify-request", MatrixDeviceVerifyRequest);



    function MatrixDeviceVerifyStart(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on('close', function(done) {
            verificationRequests.clear();
            done();
        });

        node.on('input', async function(msg){
            if(!msg.verifyRequestId || !verificationRequests.has(msg.verifyRequestId)) {
                // if(msg.userId && msg.deviceId) {
                //     node.server.beginKeyVerification("m.sas.v1", msg.userId, msg.deviceId);
                // }

                node.error("Invaid verification request: " + (msg.verifyRequestId || null));
            }

            var data = verificationRequests.get(msg.verifyRequestId);
            if(msg.cancel) {
                await data._verifier.cancel();
                verificationRequests.delete(msg.verifyRequestId);
            } else {
                try {
                    data.on('change', async function() {
                        var that = this;
                        console.log("[##### VERIFICATION PHASE CHANGE #######]", this.phase);
                        if(this.phase === 4) {
                            let verifierCancel = function(){
                                let verifyRequestId = that.targetDevice.userId + ':' + that.targetDevice.deviceId;
                                if(verificationRequests.has(verifyRequestId)) {
                                    verificationRequests.delete(verifyRequestId);
                                }
                            };

                            data._verifier.on('cancel', function(e){
                                node.warn("Device verificaiton cancelled " + e);
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
                                    console.log("!!!!!!!!!!! VERIFY THEN", e);
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
    }
    RED.nodes.registerType("matrix-device-verify-start", MatrixDeviceVerifyStart);





    function MatrixDeviceVerifyCancel(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on('close', function(done) {
            verificationRequests.clear();
            done();
        });

        node.on('input', async function(msg){
            if(!msg.verifyRequestId || !verificationRequests.has(msg.verifyRequestId)) {
                node.error("Invaid verification request: " + (msg.verifyRequestId || null));
            }

            var data = verificationRequests.get(msg.verifyRequestId);
            if(data) {
                data.cancel();
            }
        });
    }
    RED.nodes.registerType("matrix-device-verify-cancel", MatrixDeviceVerifyCancel);




    function MatrixDeviceVerifyAccept(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on('close', function(done) {
            verificationRequests.clear();
            done();
        });

        node.on('input', async function(msg){
            if(!msg.verifyRequestId || !verificationRequests.has(msg.verifyRequestId)) {
                node.error("Invaid verification request: " + (msg.verifyRequestId || null));
            }

            var data = verificationRequests.get(msg.verifyRequestId);
            if(data._verifier && data._verifier.sasEvent) {
                data._verifier.sasEvent.confirm()
                    .then(function(e){
                        console.log("!!!!!!!! CONFIRMED VERIFY", e);
                    })
                    .catch(function(e) {
                        console.log("!!!!!!!! CONFIRMED VERIFY FAILED", e);
                    });
            } else {
                console.log("Verification must be started", data);
                node.error("Verification must be started");
            }
        });
    }
    RED.nodes.registerType("matrix-device-verify-accept", MatrixDeviceVerifyAccept);
}