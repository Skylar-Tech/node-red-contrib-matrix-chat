module.exports = function(RED) {
    function MatrixReact(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;

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

        node.on("input", function (msg) {
            if (!node.server || !node.server.matrixClient) {
                node.error("No matrix server selected");
                return;
            }

            if(!node.server.isConnected()) {
                node.error("Matrix server connection is currently closed");
                node.send([null, msg]);
            }

            msg.topic = node.roomId || msg.topic;
            if(!msg.topic) {
                node.error("Room must be specified in msg.topic or in configuration");
                return;
            }

            if(!msg.payload) {
                node.error('msg.payload is required');
                return;
            }

            let eventId = msg.referenceEventId || msg.eventId;
            if(!eventId) {
                node.error('Either msg.referenceEventId or msg.eventId must be defined to react to a message.');
                return;
            }

            msg.type = 'm.reaction';

            node.server.matrixClient.sendEvent(
                msg.topic,
                'm.reaction',
                {
                    "m.relates_to": {
                        event_id: eventId,
                        key: msg.payload,
                        rel_type: "m.annotation"
                    }
                }
            )
                .then(function(e) {
                    msg.eventId = e.event_id;
                    node.send([msg, null]);
                })
                .catch(function(e){
                    msg.error = e;
                    node.send([null, msg]);
                });
        });
    }
    RED.nodes.registerType("matrix-react", MatrixReact);
}