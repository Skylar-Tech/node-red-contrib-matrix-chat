module.exports = function(RED) {
    function MatrixDeleteEvent(n) {
        RED.nodes.createNode(this,n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
        this.reason = n.reason

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }
        node.server.register(node);

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.listen(node, "disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.listen(node, "connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on('input', function(msg) {

            if(!msg.eventId) {
                node.error("eventId is missing", msg);
                node.send([null, msg])
                return;
            }

            if (!node.server || !node.server.matrixClient) {
                node.error("No matrix server selected", msg);
                msg.error = "No matrix server selected";
                node.send([null, msg]);
                return;
            }

            if(!node.server.isConnected()) {
                msg.error = "Matrix server connection is currently closed";
                node.error("Matrix server connection is currently closed", msg);
                node.send([null, msg]);
                return;
            }

            msg.topic = node.roomId || msg.topic;
            if(!msg.topic) {
                node.error("Room must be specified in msg.topic or in configuration", msg);
                msg.error = "Room must be specified in msg.topic or in configuration";
                node.send([null, msg]);
                return;
            }

            msg.reason = node.reason || msg.reason;

            if(!msg.reason) {
                msg.reason = '';
            }

            node.server.matrixClient.redactEvent(msg.topic, msg.eventId, undefined,{
                reason: msg.reason
            })

            .then(function(e) {
                msg.deleted = true
                node.send([msg, null]);
            })
            .catch(function(e){
                node.error("Error deleting event " + e, msg);
                msg.error = e;
                msg.deleted = false
                node.send([null, msg]);
            });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-delete-event",MatrixDeleteEvent);
}
