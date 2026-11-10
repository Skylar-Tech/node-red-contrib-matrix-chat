const { bindServer, onInput, inputError, requireRoom } = require("./matrix-node-utils");

module.exports = function(RED) {
    function MatrixAccountData(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.action = n.action || "get";
        node.scope = n.scope || "global";
        node.dataType = n.dataType;
        node.roomId = n.roomId;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Account data error", async function(msg) {
            const action = node.action === "msg.action" ? msg.action : node.action;
            if (action !== "get" && action !== "set") {
                throw inputError(`Action must be "get" or "set", got ${JSON.stringify(action)}`);
            }
            const dataType = node.dataType || msg.dataType;
            if (!dataType || typeof dataType !== "string") {
                throw inputError("Account data type must be set on the node or in msg.dataType, for example m.direct");
            }
            const client = node.server.matrixClient;
            const roomId = node.scope === "room" ? requireRoom(node, msg) : null;

            if (action === "set") {
                const content = msg.payload;
                if (!content || typeof content !== "object" || Array.isArray(content)) {
                    throw inputError("msg.payload must be an object with the account data content");
                }
                if (roomId) {
                    await client.setRoomAccountData(roomId, dataType, content);
                } else {
                    // Resolves once the change has come back through sync, so a
                    // "get" straight afterwards returns the new content.
                    await client.setAccountData(dataType, content);
                }
            } else if (roomId) {
                // https://spec.matrix.org/latest/client-server-api/#get_matrixclientv3useruseridroomsroomidaccount_datatype
                const path = `/user/${encodeURIComponent(client.getUserId())}/rooms/${encodeURIComponent(roomId)}/account_data/${encodeURIComponent(dataType)}`;
                try {
                    msg.payload = await client.http.authedRequest("GET", path);
                } catch (e) {
                    if (e && e.errcode === "M_NOT_FOUND") {
                        msg.payload = null;
                    } else {
                        throw e;
                    }
                }
            } else {
                msg.payload = await client.getAccountDataFromServer(dataType);
            }
            msg.dataType = dataType;
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-account-data", MatrixAccountData);
};
