const { bindServer, onInput, requireRoom, requireUserId } = require("./matrix-node-utils");

module.exports = function(RED) {
    function MatrixUnban(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.roomId = n.roomId;
        node.reason = n.reason;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Error trying to unban", async function(msg) {
            const roomId = requireRoom(node, msg);
            const userId = requireUserId(msg.userId);
            const reason = node.reason || msg.reason || undefined;
            // The SDK's unban() cannot send a reason, so call the endpoint directly.
            // https://spec.matrix.org/latest/client-server-api/#post_matrixclientv3roomsroomidunban
            const body = { user_id: userId };
            if (reason) {
                body.reason = String(reason);
            }
            await node.server.matrixClient.http.authedRequest(
                "POST", `/rooms/${encodeURIComponent(roomId)}/unban`, undefined, body);
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-room-unban", MatrixUnban);
};
