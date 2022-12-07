module.exports = function(RED) {
    function MatrixRoomInvite(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;

        if(!this.server) {
            node.error('Server must be configured on the node.');
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.server.on("Room.invite", async function(msg) {
            node.send(msg);
        });
    }
    RED.nodes.registerType("matrix-room-invite", MatrixRoomInvite);
}