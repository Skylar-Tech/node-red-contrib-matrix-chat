module.exports = function(RED) {
    function MatrixLeaveRoom(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;

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

        node.on('input', function(msg) {
            if (! node.server || ! node.server.matrixClient) {
                node.error("No matrix server selected", msg);
                return;
            }

            if(!msg.topic) {
                node.error('No room provided in msg.topic', msg);
                return;
            }

            if(!node.server.isConnected()) {
                node.error("Matrix server connection is currently closed", msg);
                node.send([null, msg]);
            }

            try {
                node.log("Leaving room " + msg.topic);
                node.server.matrixClient.leave(msg.topic);
                node.send([msg, null]);
            } catch(e) {
                node.error("Failed to leave room " + msg.topic + ": " + e, msg);
                msg.payload = e;
                node.send([null, msg]);
            }
        });
        
        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-leave-room", MatrixLeaveRoom);
}