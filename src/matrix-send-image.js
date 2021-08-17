module.exports = function(RED) {
    function MatrixSendImage(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
        this.contentType = n.contentType;

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

            if(msg.content) {
                node.server.matrixClient.sendMessage(msg.roomId, msg.content)
                    .then(function(e) {
                        node.log("Image message sent: " + e);
                        msg.eventId = e.event_id;
                        node.send([msg, null]);
                    })
                    .catch(function(e){
                        node.warn("Error sending image message " + e);
                        msg.error = e;
                        node.send([null, msg]);
                    });
                return;
            }

            if(!msg.payload) {
                node.error('msg.payload is required');
                return;
            }

            msg.contentType = msg.contentType || node.contentType;
            if(!msg.contentType) {
                node.error('msg.contentType is required');
                return;
            }

            node.log("Uploading image " + msg.filename);
            node.server.matrixClient.uploadContent(
                msg.payload, {
                    name: msg.filename || null, // Name to give the file on the server.
                    rawResponse: (msg.rawResponse || false), // Return the raw body, rather than parsing the JSON.
                    type: msg.contentType, // Content-type for the upload. Defaults to file.type, or applicaton/octet-stream.
                    onlyContentUri: false // Just return the content URI, rather than the whole body. Defaults to false. Ignored if opts.rawResponse is true.
                })
                .then(function(file){
                    node.server.matrixClient
                        .sendImageMessage(msg.roomId, file.content_uri, {}, (msg.body || msg.filename) || "")
                        .then(function(e) {
                            node.log("Image message sent: " + e);
                            msg.eventId = e.event_id;
                            node.send([msg, null]);
                        })
                        .catch(function(e){
                            node.warn("Error sending image message " + e);
                            msg.error = e;
                            node.send([null, msg]);
                        });
                })
                .catch(function(e){
                    node.warn("Error uploading image message " + e);
                    msg.matrixError = e;
                    node.send([null, msg]);
                });
        });
    }
    RED.nodes.registerType("matrix-send-image", MatrixSendImage);
}