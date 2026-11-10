const { bindServer, onInput, inputError } = require("./matrix-node-utils");

module.exports = function(RED) {
    function MatrixKnockRoom(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.roomId = n.roomId;
        node.reason = n.reason;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Error knocking on room", async function(msg) {
            const roomIdOrAlias = node.roomId || msg.topic;
            if (!roomIdOrAlias || typeof roomIdOrAlias !== "string") {
                throw inputError("Room ID or alias must be specified in msg.topic or in configuration");
            }
            const reason = node.reason || msg.reason || undefined;
            const opts = {};
            if (reason) {
                opts.reason = String(reason);
            }
            if (msg.viaServers) {
                opts.viaServers = msg.viaServers;
            }
            const result = await node.server.matrixClient.knockRoom(roomIdOrAlias, opts);
            msg.topic = result.room_id;
            msg.payload = { roomId: result.room_id, membership: "knock" };
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-knock-room", MatrixKnockRoom);
};
