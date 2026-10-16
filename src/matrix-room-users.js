module.exports = function(RED) {
    function MatrixRoomUsers(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;

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
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            if(!node.server.isConnected()) {
                msg.error = "Matrix server connection is currently closed";
                node.error("Matrix server connection is currently closed", msg);
                node.send([null, msg]);
                return;
            }

            let roomId = node.roomId || msg.topic;
            if(!roomId) {
                msg.error = "msg.topic is required. Specify in the input or configure the room ID on the node.";
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            node.server.matrixClient
                .getJoinedRoomMembers(roomId)
                .then(function(e){
                    msg.payload = e;
                    node.send([msg, null]);
                }).catch(function(e){
                    node.error("Error fetching room user list " + e, msg);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-room-users", MatrixRoomUsers);
}