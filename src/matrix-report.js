const { bindServer, onInput, inputError, requireRoom, requireUserId } = require("./matrix-node-utils");

const REPORT_TYPES = ["event", "room", "user"];

module.exports = function(RED) {
    function MatrixReport(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.name = n.name;
        node.roomId = n.roomId;
        node.reportType = n.reportType || "event";
        node.reason = n.reason;

        if (!bindServer(RED, node, n)) {
            return;
        }

        onInput(node, "Report failed", async function(msg) {
            const reportType = node.reportType === "msg.reportType" ? msg.reportType : node.reportType;
            if (!REPORT_TYPES.includes(reportType)) {
                throw inputError(`Report type must be one of ${REPORT_TYPES.join(", ")}, got ${JSON.stringify(reportType)}`);
            }
            const reason = node.reason || msg.reason || undefined;
            const body = reason ? { reason: String(reason) } : {};
            const http = node.server.matrixClient.http;
            let path;

            // https://spec.matrix.org/latest/client-server-api/#reporting-content
            if (reportType === "event") {
                const roomId = requireRoom(node, msg);
                if (!msg.eventId) {
                    throw inputError("msg.eventId must be set to report an event");
                }
                path = `/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(msg.eventId)}`;
            } else if (reportType === "room") {
                const roomId = requireRoom(node, msg);
                path = `/rooms/${encodeURIComponent(roomId)}/report`;
            } else {
                const userId = requireUserId(msg.userId);
                path = `/users/${encodeURIComponent(userId)}/report`;
            }

            await http.authedRequest("POST", path, undefined, body);
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-report", MatrixReport);
};
