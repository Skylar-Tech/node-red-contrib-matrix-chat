const { bindServer, onInput, inputError, requireRoom } = require("./matrix-node-utils");

const ACTIONS = ["search", "visibility", "publish", "unpublish"];

module.exports = function(RED) {
    function MatrixRoomDirectory(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.action = n.action || "search";
        node.roomId = n.roomId;
        node.limit = parseInt(n.limit, 10) || 20;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Room directory error", async function(msg) {
            const action = node.action === "msg.action" ? msg.action : node.action;
            if (!ACTIONS.includes(action)) {
                throw inputError(`Action must be one of ${ACTIONS.join(", ")}, got ${JSON.stringify(action)}`);
            }
            const client = node.server.matrixClient;

            if (action === "search") {
                // https://spec.matrix.org/latest/client-server-api/#post_matrixclientv3publicrooms
                const opts = { limit: parseInt(msg.limit, 10) || node.limit };
                if (typeof msg.payload === "string" && msg.payload.trim()) {
                    opts.filter = { generic_search_term: msg.payload.trim() };
                }
                if (typeof msg.since === "string" && msg.since) {
                    opts.since = msg.since;
                }
                if (typeof msg.server === "string" && msg.server) {
                    opts.server = msg.server;
                }
                const result = await client.publicRooms(opts);
                msg.payload = result.chunk || [];
                msg.nextBatch = result.next_batch || null;
                msg.totalRoomCountEstimate = result.total_room_count_estimate === undefined ? null : result.total_room_count_estimate;
            } else if (action === "visibility") {
                const roomId = requireRoom(node, msg);
                const result = await client.getRoomDirectoryVisibility(roomId);
                msg.payload = result.visibility;
            } else {
                const roomId = requireRoom(node, msg);
                const visibility = action === "publish" ? "public" : "private";
                await client.setRoomDirectoryVisibility(roomId, visibility);
                msg.payload = visibility;
            }
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-room-directory", MatrixRoomDirectory);
};
