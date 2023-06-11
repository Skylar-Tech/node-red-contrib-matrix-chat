module.exports = function(RED) {
    function MatrixBan(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
        this.reason = n.reason;

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }
        node.server.register(node);

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on("input", function (msg) {
            if (! node.server || ! node.server.matrixClient) {
                node.error("No matrix server selected", {});
                return;
            }

            if(!node.server.isConnected()) {
                node.error("Matrix server connection is currently closed", {});
                node.send([null, msg]);
            }

            msg.topic = node.roomId || msg.topic;
            if(!msg.topic) {
                node.error("Room must be specified in msg.topic or in configuration", {});
                return;
            }

            if(!msg.userId) {
                node.error("msg.userId was not set.", {});
                return;
            }

            node.server.matrixClient.ban(msg.topic, msg.userId, n.reason || msg.reason || undefined)
                .then(function(e) {
                    node.log("Successfully banned " + msg.userId + " from " + msg.topic);
                    msg.eventId = e.event_id;
                    node.send([msg, null]);
                })
                .catch(function(e){
                    node.error("Error trying to ban " + msg.userId + " from " + msg.topic, {});
                    msg.error = e;
                    node.send([null, msg]);
                });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-room-ban", MatrixBan);
}