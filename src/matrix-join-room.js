module.exports = function(RED) {
    function MatrixJoinRoom(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);

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

            if(!msg.topic) {
                node.error("Room must be specified in msg.topic");
                return;
            }

            node.server.matrixClient.joinRoom(msg.topic, msg.joinOpts || {})
                .then(function(e) {
                    msg.payload = e;
                    msg.topic = e.roomId;
                    node.log("Successfully joined room " + msg.topic);
                    node.send([msg, null]);
                })
                .catch(function(e){
                    node.error("Error trying to join room " + msg.topic + ":" + e);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });
    }
    RED.nodes.registerType("matrix-join-room", MatrixJoinRoom);
}