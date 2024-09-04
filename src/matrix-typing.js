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

            if(!node.server.isConnected()) {
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
                    return;
                }

                await node.server.matrixClient.sendTyping(roomId, typing, timeoutMs);
                node.send([msg, null]);
            } catch(e) {
                node.error("Failed to send typing event " + msg.topic + ": " + e, msg);
                msg.payload = e;
                node.send([null, msg]);
            }
        });
        
        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-typing", MatrixTyping);
}