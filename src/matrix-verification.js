module.exports = function(RED) {
    function MatrixVerification(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);

        // Phase filter - emit only the ticked phases. Undefined (config saved
        // before these options existed) is treated as ticked, so old nodes
        // keep emitting every phase.
        this.phases = {
            requested: n.phaseRequested !== false,
            ready:     n.phaseReady     !== false,
            started:   n.phaseStarted   !== false,
            sas:       n.phaseSas       !== false,
            done:      n.phaseDone      !== false,
            cancelled: n.phaseCancelled !== false,
        };
        this.initiatedBy = n.initiatedBy || 'any';           // any | me | notme
        this.verificationType = n.verificationType || 'any'; // any | room | device
        this.selfVerification = n.selfVerification || 'any'; // any | self | others
        this.userFilter = (n.userFilter || '').split(',')
            .map(function(s){ return s.trim().toLowerCase(); })
            .filter(Boolean);
        this.roomFilter = (n.roomFilter || '').split(',')
            .map(function(s){ return s.trim(); })
            .filter(Boolean);

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        if (!node.server) {
            node.error("No configuration node");
            return;
        }
        node.server.register(node);

        // Returns true if a verification update message passes every configured
        // filter. All filters AND-combine; each defaults to "pass everything".
        function passesFilters(m) {
            // phase
            if ((m.phase in node.phases) && !node.phases[m.phase]) {
                return false;
            }
            // initiated by
            if (node.initiatedBy === 'me' && !m.initiatedByMe) {
                return false;
            }
            if (node.initiatedBy === 'notme' && m.initiatedByMe) {
                return false;
            }
            // verification type - room verifications carry a roomId (msg.topic),
            // to-device verifications do not
            if (node.verificationType === 'room' && !m.topic) {
                return false;
            }
            if (node.verificationType === 'device' && m.topic) {
                return false;
            }
            // self-verification (the other party is one of the bot's own devices)
            if (node.selfVerification === 'self' && !m.isSelfVerification) {
                return false;
            }
            if (node.selfVerification === 'others' && m.isSelfVerification) {
                return false;
            }
            // user id allowlist
            if (node.userFilter.length &&
                (!m.userId || node.userFilter.indexOf(m.userId.toLowerCase()) === -1)) {
                return false;
            }
            // room id filter - only constrains room verifications; device
            // verifications have no room and are not affected
            if (node.roomFilter.length && m.topic &&
                node.roomFilter.indexOf(m.topic) === -1) {
                return false;
            }
            return true;
        }

        const onConnected = function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        };
        const onDisconnected = function() {
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        };
        const onVerificationUpdate = function(verificationMsg) {
            if (!passesFilters(verificationMsg)) {
                return;
            }
            node.status({ fill: "blue", shape: "dot", text: verificationMsg.phase });
            // clone so multiple verification nodes don't share/mutate one object
            node.send(RED.util.cloneMessage(verificationMsg));
        };

        node.server.on("connected", onConnected);
        node.server.on("disconnected", onDisconnected);
        node.server.on("Verification.update", onVerificationUpdate);

        if (node.server.isConnected && node.server.isConnected()) {
            onConnected();
        }

        node.on("close", function() {
            node.server.removeListener("connected", onConnected);
            node.server.removeListener("disconnected", onDisconnected);
            node.server.removeListener("Verification.update", onVerificationUpdate);
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-verification", MatrixVerification);
}
