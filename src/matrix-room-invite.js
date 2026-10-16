module.exports = function(RED) {
    function MatrixRoomInvite(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;

        if(!this.server) {
            node.error('Server must be configured on the node.', {});
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

        node.server.listen(node, "Room.invite", function(sharedMsg) {
            // every Room Invite node gets the same msg; send a private copy
            // (the live MatrixEvent stays shared, like in matrix-receive)
            const { event, ...plain } = sharedMsg;
            const msg = RED.util.cloneMessage(plain);
            msg.event = event;
            node.send(msg);
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-room-invite", MatrixRoomInvite);
}