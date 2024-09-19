module.exports = function(RED) {
    function MatrixGetEvent(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomIdType = n.roomIdType;
        this.roomIdValue = n.roomIdValue;
        this.eventIdType = n.eventIdType;
        this.eventIdValue = n.eventIdValue;

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        if (!node.server) {
            node.error("No configuration node", {});
            return;
        }
        node.server.register(node);

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on('input', async function(msg) {
            if (! node.server || ! node.server.matrixClient) {
                node.error("No matrix server selected", msg);
                node.send([null, msg]);
                return;
            }

            if (!node.server.isConnected()) {
                node.error("Matrix server connection is currently closed", msg);
                node.send([null, msg]);
                return;
            }

            function getToValue(msg, type, property) {
                let value = property;
                if (type === "msg") {
                    value = RED.util.getMessageProperty(msg, property);
                } else if ((type === 'flow') || (type === 'global')) {
                    try {
                        value = RED.util.evaluateNodeProperty(property, type, node, msg);
                    } catch(e2) {
                        throw new Error("Invalid value evaluation");
                    }
                } else if(type === "bool") {
                    value = (property === 'true');
                } else if(type === "num") {
                    value = Number(property);
                }
                return value;
            }

            try {
                let roomId = getToValue(msg, node.roomIdType, node.roomIdValue),
                    eventId = getToValue(msg, node.eventIdType, node.eventIdValue);

                if(!roomId) {
                    node.error('Missing roomId', msg);
                    return;
                } else if(!eventId) {
                    node.error('Missing eventId', msg);
                    return;
                }

                msg.payload = await node.server.matrixClient.fetchRoomEvent(roomId, eventId);
                node.send([msg, null]);
            } catch(e) {
                node.error("Failed to get event " + msg.topic + ": " + e, msg);
                msg.payload = e;
                node.send([null, msg]);
            }
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-get-event", MatrixGetEvent);
}
