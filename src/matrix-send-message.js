module.exports = function(RED) {
    function MatrixSendImage(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
        this.htmlMessage = n.htmlMessage;

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on("input", function (msg) {
            if (! node.server || ! node.server.matrixClient) {
                node.warn("No matrix server selected");
                return;
            }

            if(!node.server.isConnected()) {
                node.error("Matrix server connection is currently closed");
                node.send([null, msg]);
            }

            msg.roomId = node.roomId || msg.roomId;
            if(!msg.roomId) {
                node.warn("Room must be specified in msg.roomId or in configuration");
                return;
            }

            if(!msg.payload) {
                node.error('msg.payload is required');
                return;
            }

            if(this.htmlMessage) {
                node.server.matrixClient.sendHtmlMessage(msg.roomId, msg.payload.toString(), msg.payload.toString())
                    .then(function(e) {
                        node.log("Message sent: " + msg.payload);
                        msg.eventId = e.eventId;
                        node.send([msg, null]);
                    })
                    .catch(function(e){
                        node.warn("Error sending message " + e);
                        msg.matrixError = e;
                        node.send([null, msg]);
                    });
            } else {
                node.server.matrixClient.sendTextMessage(msg.roomId, msg.payload.toString())
                    .then(function(e) {
                        node.log("Message sent: " + msg.payload);
                        msg.eventId = e.eventId;
                        node.send([msg, null]);
                    })
                    .catch(function(e){
                        node.warn("Error sending message " + e);
                        msg.matrixError = e;
                        node.send([null, msg]);
                    });
            }
        });
    }
    RED.nodes.registerType("matrix-send-message", MatrixSendImage);
}