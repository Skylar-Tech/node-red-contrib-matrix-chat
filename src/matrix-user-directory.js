const { bindServer, onInput, inputError } = require("./matrix-node-utils");

module.exports = function(RED) {
    function MatrixUserDirectory(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.limit = parseInt(n.limit, 10) || 10;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "User directory search failed", async function(msg) {
            const term = typeof msg.payload === "string" ? msg.payload.trim() : "";
            if (!term) {
                throw inputError("msg.payload must be the text to search for");
            }
            const result = await node.server.matrixClient.searchUserDirectory({
                term: term,
                limit: parseInt(msg.limit, 10) || node.limit,
            });
            msg.payload = (result.results || []).map((u) => ({
                userId: u.user_id,
                displayName: u.display_name || null,
                avatarUrl: u.avatar_url || null,
            }));
            msg.limited = !!result.limited;
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-user-directory", MatrixUserDirectory);
};
