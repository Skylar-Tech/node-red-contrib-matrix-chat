const { bindServer, onInput, requireRoom } = require("./matrix-node-utils");

module.exports = function(RED) {
    function MatrixSpaceHierarchy(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.roomId = n.roomId;
        node.maxDepth = (n.maxDepth === "" || n.maxDepth === undefined || n.maxDepth === null) ? undefined : parseInt(n.maxDepth, 10);
        node.limit = parseInt(n.limit, 10) || 100;
        node.suggestedOnly = n.suggestedOnly === true;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Space hierarchy error", async function(msg) {
            const spaceId = requireRoom(node, msg);
            const limit = parseInt(msg.limit, 10) || node.limit;
            const client = node.server.matrixClient;
            let rooms = [];
            let from = (typeof msg.nextBatch === "string" && msg.nextBatch) ? msg.nextBatch : undefined;
            // Follow the pages until there are no more or we have enough rooms.
            // https://spec.matrix.org/latest/client-server-api/#get_matrixclientv1roomsroomidhierarchy
            do {
                const page = await client.getRoomHierarchy(spaceId, Math.min(limit - rooms.length, 50),
                    Number.isFinite(node.maxDepth) ? node.maxDepth : undefined, node.suggestedOnly, from);
                rooms = rooms.concat(page.rooms || []);
                from = page.next_batch;
            } while (from && rooms.length < limit);

            msg.payload = rooms.slice(0, limit);
            msg.nextBatch = from || null;
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-space-hierarchy", MatrixSpaceHierarchy);
};
