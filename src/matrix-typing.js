module.exports = function(RED) {
    function MatrixTyping(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
        this.roomType = n.roomType;
        this.roomValue = n.roomValue;
        this.typingType = n.typingType;
        this.typingValue = n.typingValue;
        this.timeoutMsType = n.timeoutMsType;
        this.timeoutMsValue = n.timeoutMsValue;

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        if (!node.server) {
            node.error("No configuration node", {});
            return;
        }
        node.server.register(node);

        node.server.listen(node, "disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.listen(node, "connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on('input', async function(msg) {
            if (! node.server || ! node.server.matrixClient) {
                msg.error = "No matrix server selected";
                node.error("No matrix server selected", msg);
                node.send([null, msg]);
                return;
            }

            if(!node.server.isConnected()) {
                msg.error = "Matrix server connection is currently closed";
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
                let roomId = getToValue(msg, node.roomType, node.roomValue),
                    typing = getToValue(msg, node.typingType, node.typingValue),
                    timeoutMs = getToValue(msg, node.timeoutMsType, node.timeoutMsValue);

                if(!roomId) {
                    node.error('No room provided in msg.topic', msg);
                    msg.error = 'No room provided in msg.topic';
                    node.send([null, msg]);
                    return;
                }

                // The SDK treats any truthy value as "typing", so the string
                // "false" (e.g. from a msg property) used to start typing.
                if (typeof typing === 'string') {
                    typing = typing.trim().toLowerCase() === 'true';
                }
                typing = !!typing;

                await node.server.matrixClient.sendTyping(roomId, typing, timeoutMs);
                node.send([msg, null]);
            } catch(e) {
                node.error("Failed to send typing event " + msg.topic + ": " + e, msg);
                msg.error = e;
                node.send([null, msg]);
            }
        });
        
        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-typing", MatrixTyping);
}