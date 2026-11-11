const { bindServer, onInput, inputError, requireUserId } = require("./matrix-node-utils");

const ACTIONS = ["get", "ignore", "unignore"];

module.exports = function(RED) {
    function MatrixIgnoreUsers(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.action = n.action || "get";

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Ignore users error", async function(msg) {
            const action = node.action === "msg.action" ? msg.action : node.action;
            if (!ACTIONS.includes(action)) {
                throw inputError(`Action must be one of ${ACTIONS.join(", ")}, got ${JSON.stringify(action)}`);
            }
            const client = node.server.matrixClient;
            // The synced copy, or the server's before the first sync. A change
            // waits for sync to echo it back, so this is never stale after one.
            const current = await client.getAccountDataFromServer("m.ignored_user_list");
            let ignored = Object.keys((current && current.ignored_users) || {});

            if (action !== "get") {
                const input = Array.isArray(msg.userId) ? msg.userId : [msg.userId];
                if (!input.length) {
                    throw inputError("msg.userId must be a user ID or an array of user IDs");
                }
                const userIds = input.map((id) => requireUserId(id));
                const next = action === "ignore"
                    ? ignored.concat(userIds.filter((id) => !ignored.includes(id)))
                    : ignored.filter((id) => !userIds.includes(id));
                if (next.length !== ignored.length) {
                    await client.setIgnoredUsers(next);
                }
                ignored = next;
            }

            msg.payload = ignored;
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-ignore-users", MatrixIgnoreUsers);
};
