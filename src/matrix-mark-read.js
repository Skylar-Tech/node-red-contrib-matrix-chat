const crypto = require('crypto');

module.exports = function(RED) {
    function MatrixMarkRead(n) {
        RED.nodes.createNode(this, n);
        let node = this;
        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomType = n.roomType;
        this.roomValue = n.roomValue;
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

        node.on("input", async function (msg) {
            if (!node.server || !node.server.matrixClient) {
                node.error("No matrix server selected", msg);
                return;
            }

            function getToValue(msg, type, property) {
                let value = property;
                if (type === "msg") {
                    value = RED.util.getMessageProperty(msg, property);
                } else if (type === 'flow' || type === 'global') {
                    try {
                        value = RED.util.evaluateNodeProperty(property, type, node, msg);
                    } catch (e2) {
                        throw new Error("Invalid value evaluation");
                    }
                } else if (type === "bool") {
                    value = (property === 'true');
                } else if (type === "num") {
                    value = Number(property);
                }
                return value;
            }

            try {
                let roomId = getToValue(msg, node.roomType, node.roomValue),
                    eventId = getToValue(msg, node.eventIdType, node.eventIdValue);

                const room = node.server.matrixClient.getRoom(roomId);
                if (!room) {
                    throw new Error(`Room ${roomId} not found.`);
                }

                const event = room.findEventById(eventId);
                if (!event) {
                    throw new Error(`Event ${eventId} not found in room ${roomId}.`);
                }

                await node.server.matrixClient.sendReceipt(event, "m.read");
                node.send([msg, null]);
            } catch (e) {
                msg.error = `Room pagination error: ${e}`;
                node.error(msg.error, msg);
                node.send([null, msg]);
            }
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-mark-read", MatrixMarkRead);
}
