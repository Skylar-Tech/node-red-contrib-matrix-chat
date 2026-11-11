const { bindServer, onInput, inputError } = require("./matrix-node-utils");

module.exports = function(RED) {
    function MatrixRoomSummary(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.roomId = n.roomId;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Room summary error", async function(msg) {
            const roomIdOrAlias = node.roomId || msg.topic;
            if (!roomIdOrAlias || typeof roomIdOrAlias !== "string") {
                throw inputError("Room ID or alias must be specified in msg.topic or in configuration");
            }
            let via = msg.viaServers;
            if (typeof via === "string") {
                via = [via];
            }
            // Uses the stable endpoint from Matrix 1.15, falling back to the
            // older unstable one on servers that do not support it yet.
            const summary = await node.server.matrixClient.getRoomSummary(roomIdOrAlias, Array.isArray(via) ? via : undefined);
            // the older endpoint prefixes these two fields
            if (summary.room_version === undefined && summary["im.nheko.summary.room_version"] !== undefined) {
                summary.room_version = summary["im.nheko.summary.room_version"];
            }
            if (summary.encryption === undefined && summary["im.nheko.summary.encryption"] !== undefined) {
                summary.encryption = summary["im.nheko.summary.encryption"];
            }
            msg.topic = summary.room_id || roomIdOrAlias;
            msg.payload = summary;
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-room-summary", MatrixRoomSummary);
};
