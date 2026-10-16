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

        node.server.listen(node, "disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.listen(node, "connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on("input", function (msg) {
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

            msg.topic = node.roomId || msg.topic;
            if(!msg.topic) {
                msg.error = "Room must be specified in msg.topic or in configuration";
                node.error("Room must be specified in msg.topic or in configuration", msg);
                node.send([null, msg]);
                return;
            }

            if(!msg.userId) {
                msg.error = "msg.userId was not set.";
                node.error("msg.userId was not set.", msg);
                node.send([null, msg]);
                return;
            }

            node.server.matrixClient.ban(msg.topic, msg.userId, n.reason || msg.reason || undefined)
                .then(function() {
                    // the endpoint returns {} (no event id), so msg is passed on unchanged
                    node.log("Successfully banned " + msg.userId + " from " + msg.topic);
                    node.send([msg, null]);
                })
                .catch(function(e){
                    node.error("Error trying to ban " + msg.userId + " from " + msg.topic, msg);
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