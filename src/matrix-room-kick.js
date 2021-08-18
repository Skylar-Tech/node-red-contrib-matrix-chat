module.exports = function(RED) {
    function MatrixKick(n) {
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
            if (! node.server || ! node.server.matrixClient) {
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

            if(!msg.userId) {
                node.error("msg.userId was not set.");
                return;
            }

            node.server.matrixClient.kick(msg.topic, msg.userId, msg.reason || undefined)
                .then(function(e) {
                    node.log("Successfully kicked " + msg.userId + " from " + msg.topic);
                    msg.eventId = e.event_id;
                    node.send([msg, null]);
                })
                .catch(function(e){
                    node.error("Error trying to kick " + msg.userId + " from " + msg.topic);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });
    }
    RED.nodes.registerType("matrix-room-kick", MatrixKick);
}