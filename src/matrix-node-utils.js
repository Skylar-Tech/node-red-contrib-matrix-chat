/**
 * Shared plumbing for nodes that act on the Matrix client of a
 * matrix-server-config node: connection status, input checks, typed inputs
 * and reporting errors once (to Catch nodes and the error output).
 */

/**
 * Register a node with its server config node and keep its status in sync.
 *
 * @returns {boolean} false when no server config is selected (the node then
 *   does nothing).
 */
function bindServer(RED, node, n) {
    node.server = RED.nodes.getNode(n.server);
    if (!node.server) {
        node.warn("No configuration node");
        return false;
    }
    node.server.register(node);
    node.status({ fill: "red", shape: "ring", text: "disconnected" });
    node.server.listen(node, "disconnected", function() {
        node.status({ fill: "red", shape: "ring", text: "disconnected" });
    });
    node.server.listen(node, "connected", function() {
        node.status({ fill: "green", shape: "ring", text: "connected" });
    });
    node.on("close", function() {
        node.server.deregister(node);
    });
    return true;
}

/**
 * Readable text for an error from the SDK or the homeserver.
 */
function errorText(e) {
    if (!e) {
        return "Unknown error";
    }
    if (e.data && e.data.error) {
        return e.errcode ? `${e.data.error} (${e.errcode})` : e.data.error;
    }
    return e.message || String(e);
}

/**
 * Report a failure once: Catch nodes get it through node.error, and the msg
 * goes to the error output (output 2) with msg.error set.
 */
function sendError(node, msg, text) {
    msg.error = text;
    node.error(text, msg);
    node.send([null, msg]);
}

/**
 * Wrap an async input handler: checks the server is connected, then runs
 * `handler(msg)`. Anything it throws is reported with `prefix`.
 */
function onInput(node, prefix, handler) {
    node.on("input", async function(msg) {
        if (!node.server || !node.server.matrixClient) {
            sendError(node, msg, "No matrix server selected");
            return;
        }
        if (!node.server.isConnected()) {
            sendError(node, msg, "Matrix server connection is currently closed");
            return;
        }
        try {
            await handler(msg);
        } catch (e) {
            sendError(node, msg, (e && e.userFacing) ? e.message : `${prefix}: ${errorText(e)}`);
        }
    });
}

/**
 * An error whose message is shown as-is (no prefix), for bad input.
 */
function inputError(text) {
    const e = new Error(text);
    e.userFacing = true;
    return e;
}

/**
 * Resolve a typed input. Supports msg, flow, global, str, num, bool and json.
 * Returns undefined for an empty str/num so optional settings can opt out.
 */
function getTypedValue(RED, node, msg, type, value) {
    switch (type) {
        case "msg":
            return RED.util.getMessageProperty(msg, value);
        case "flow":
        case "global":
            try {
                return RED.util.evaluateNodeProperty(value, type, node, msg);
            } catch (e) {
                throw inputError(`Invalid ${type} value evaluation for '${value}'`);
            }
        case "num":
            if (value === "" || value === undefined || value === null) return undefined;
            return Number(value);
        case "bool":
            return value === true || value === "true";
        case "json":
            try {
                return JSON.parse(value);
            } catch (e) {
                throw inputError(`Invalid JSON: ${e.message}`);
            }
        default:
            return (value === "" || value === undefined || value === null) ? undefined : value;
    }
}

/**
 * The room for a node: its configured room, else msg.topic.
 */
function requireRoom(node, msg) {
    const roomId = node.roomId || msg.topic;
    if (!roomId || typeof roomId !== "string") {
        throw inputError("Room must be specified in msg.topic or in configuration");
    }
    msg.topic = roomId;
    return roomId;
}

/**
 * Check a user ID looks like @localpart:server.
 */
function requireUserId(value, what) {
    if (typeof value !== "string" || !value.startsWith("@") || value.indexOf(":") === -1) {
        throw inputError(`${what || "msg.userId"} must be a user ID like @user:server`);
    }
    return value;
}

module.exports = {
    bindServer,
    errorText,
    sendError,
    onInput,
    inputError,
    getTypedValue,
    requireRoom,
    requireUserId,
};
