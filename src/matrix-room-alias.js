const { bindServer, onInput, inputError, requireRoom } = require("./matrix-node-utils");

const ACTIONS = ["resolve", "create", "delete", "list"];

function requireAlias(alias) {
    if (typeof alias !== "string" || !alias.startsWith("#") || alias.indexOf(":") === -1) {
        throw inputError("Room alias must look like #name:server (set msg.alias or configure it on the node)");
    }
    return alias;
}

module.exports = function(RED) {
    function MatrixRoomAlias(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.action = n.action || "resolve";
        node.alias = n.alias;
        node.roomId = n.roomId;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Room alias error", async function(msg) {
            const action = node.action === "msg.action" ? msg.action : node.action;
            if (!ACTIONS.includes(action)) {
                throw inputError(`Action must be one of ${ACTIONS.join(", ")}, got ${JSON.stringify(action)}`);
            }
            const client = node.server.matrixClient;

            if (action === "resolve") {
                const alias = requireAlias(node.alias || msg.alias);
                const result = await client.getRoomIdForAlias(alias);
                msg.topic = result.room_id;
                msg.payload = { alias: alias, roomId: result.room_id, servers: result.servers || [] };
            } else if (action === "create") {
                const alias = requireAlias(node.alias || msg.alias);
                const roomId = requireRoom(node, msg);
                await client.createAlias(alias, roomId);
                msg.payload = { alias: alias, roomId: roomId };
            } else if (action === "delete") {
                const alias = requireAlias(node.alias || msg.alias);
                await client.deleteAlias(alias);
                msg.payload = { alias: alias };
            } else {
                const roomId = requireRoom(node, msg);
                const result = await client.getLocalAliases(roomId);
                msg.payload = result.aliases || [];
            }
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-room-alias", MatrixRoomAlias);
};
