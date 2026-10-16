module.exports = function(RED) {
    function MatrixReact(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
        this.reaction = n.reaction;

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }
        node.server.register(node);

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.listen(node, "disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.listen(node, "connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on("input", function (msg) {
            if (!node.server || !node.server.matrixClient) {
                node.error("No matrix server selected", msg);
                msg.error = "No matrix server selected";
                node.send([null, msg]);
                return;
            }

            if(!node.server.isConnected()) {
                msg.error = "Matrix server connection is currently closed";
                node.error("Matrix server connection is currently closed", msg);
                node.send([null, msg]);
                return;
            }

            msg.topic = node.roomId || msg.topic;
            if(!msg.topic) {
                node.error("Room must be specified in msg.topic or in configuration", msg);
                msg.error = "Room must be specified in msg.topic or in configuration";
                node.send([null, msg]);
                return;
            }

            let payload = n.reaction || msg.payload;
            if(!payload) {
                node.error('msg.payload must be defined or the reaction configured on the node.', msg);
                msg.error = 'msg.payload must be defined or the reaction configured on the node.';
                node.send([null, msg]);
                return;
            }

            let eventId = msg.referenceEventId || msg.eventId;
            if(!eventId) {
                node.error('Either msg.referenceEventId or msg.eventId must be defined to react to a message.', msg);
                msg.error = 'Either msg.referenceEventId or msg.eventId must be defined to react to a message.';
                node.send([null, msg]);
                return;
            }

            msg.type = 'm.reaction';

            node.server.matrixClient.sendEvent(
                msg.topic,
                'm.reaction',
                {
                    "m.relates_to": {
                        event_id: eventId,
                        key: payload,
                        rel_type: "m.annotation"
                    }
                }
            )
                .then(function(e) {
                    msg.eventId = e.event_id;
                    node.send([msg, null]);
                })
                .catch(function(e){
                    node.error("Error sending reaction: " + e, msg);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-react", MatrixReact);
}