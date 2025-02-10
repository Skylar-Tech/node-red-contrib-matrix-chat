const sdkPromise = import("matrix-js-sdk");

module.exports = function(RED) {
    function MatrixFetchRelations(n) {
        RED.nodes.createNode(this, n);

        let node = this;
        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomType = n.roomType;
        this.roomValue = n.roomValue;
        this.eventIdType = n.eventIdType;
        this.eventIdValue = n.eventIdValue;
        this.relationTypeType = n.relationTypeType;
        this.relationTypeValue = n.relationTypeValue;
        this.eventTypeType = n.eventTypeType;
        this.eventTypeValue = n.eventTypeValue;
        this.directionType = n.directionType;
        this.directionValue = n.directionValue;
        this.limitType = n.limitType;
        this.limitValue = n.limitValue;
        this.recurseType = n.recurseType;
        this.recurseValue = n.recurseValue;
        this.fromType = n.fromType;
        this.fromValue = n.fromValue;
        this.toType = n.toType;
        this.toValue = n.toValue;

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        if (!node.server) {
            node.error("No configuration node", {});
            return;
        }
        node.server.register(node);

        node.server.on("disconnected", function() {
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on("input", async function(msg) {
            if (!node.server || !node.server.matrixClient) {
                node.error("No matrix server selected", msg);
                return;
            }

            try {
                const sdk = await sdkPromise;
                const Direction = sdk.Direction;

                function evaluateNodePropertySafe(value, type, node, msg) {
                    try {
                        return RED.util.evaluateNodeProperty(value, type, node, msg);
                    } catch (e) {
                        if (e instanceof TypeError) {
                            return undefined;
                        }
                        throw e;
                    }
                }

                let roomId = RED.util.evaluateNodeProperty(node.roomValue, node.roomType, node, msg),
                    eventId = RED.util.evaluateNodeProperty(node.eventIdValue, node.eventIdType, node, msg),
                    relationType = RED.util.evaluateNodeProperty(node.relationTypeValue, node.relationTypeType, node, msg),
                    eventType = RED.util.evaluateNodeProperty(node.eventTypeValue, node.eventTypeType, node, msg),
                    direction = RED.util.evaluateNodeProperty(node.directionValue, node.directionType, node, msg) || Direction.Backward,
                    limit = RED.util.evaluateNodeProperty(node.limitValue, node.limitType, node, msg),
                    recurse = RED.util.evaluateNodeProperty(node.recurseValue, node.recurseType, node, msg),
                    from = evaluateNodePropertySafe(node.fromValue, node.fromType, node, msg),
                    to = evaluateNodePropertySafe(node.toValue, node.toType, node, msg);

                let opts = { dir: direction };
                if (limit) {
                    opts.limit = limit;
                }
                if (recurse === true || recurse === false) {
                    opts.recurse = recurse;
                }
                if (from) {
                    opts.from = from;
                }
                if (to) {
                    opts.to = to;
                }

                msg.payload = await node.server.matrixClient.fetchRelations(
                    roomId,
                    eventId,
                    relationType || null,
                    eventType || null,
                    opts
                );
                node.send([msg, null]);
            } catch (e) {
                msg.error = `Event relations pagination error: ${e.stack}`;
                node.error(msg.error, msg);
                node.send([null, msg]);
            }
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }

    RED.nodes.registerType("matrix-fetch-relations", MatrixFetchRelations);
};
