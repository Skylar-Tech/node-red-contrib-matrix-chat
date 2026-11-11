const { bindServer, onInput, inputError, requireRoom } = require("./matrix-node-utils");

const ACTIONS = ["get", "add", "remove"];

module.exports = function(RED) {
    function MatrixRoomTags(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.action = n.action || "get";
        node.roomId = n.roomId;
        node.tag = n.tag;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Room tag error", async function(msg) {
            const action = node.action === "msg.action" ? msg.action : node.action;
            if (!ACTIONS.includes(action)) {
                throw inputError(`Action must be one of ${ACTIONS.join(", ")}, got ${JSON.stringify(action)}`);
            }
            const client = node.server.matrixClient;
            const roomId = requireRoom(node, msg);

            if (action !== "get") {
                const tag = node.tag || msg.tag;
                if (!tag || typeof tag !== "string") {
                    throw inputError("Tag must be set on the node or in msg.tag, for example m.favourite or u.work");
                }
                if (action === "add") {
                    const metadata = {};
                    if (msg.order !== undefined && msg.order !== null && msg.order !== "") {
                        const order = Number(msg.order);
                        if (!Number.isFinite(order) || order < 0 || order > 1) {
                            throw inputError("msg.order must be a number from 0 to 1");
                        }
                        metadata.order = order;
                    }
                    await client.setRoomTag(roomId, tag, metadata);
                } else {
                    await client.deleteRoomTag(roomId, tag);
                }
            }

            const result = await client.getRoomTags(roomId);
            msg.payload = (result && result.tags) || {};
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-room-tags", MatrixRoomTags);
};
