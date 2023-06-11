module.exports = function(RED) {
    function MatrixSendFile(n) {
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
        node.server.register(node);

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
                node.error("Matrix server connection is currently closed", {});
                node.send([null, msg]);
            }

            msg.topic = node.roomId || msg.topic;
            if(!msg.topic) {
                node.warn("Room must be specified in msg.topic or in configuration");
                return;
            }

            if(msg.content && msg.type === 'm.file') {
                node.server.matrixClient.sendMessage(msg.topic, msg.content)
                    .then(function(e) {
                        node.log("File message sent: " + e);
                        msg.eventId = e.event_id;
                        node.send([msg, null]);
                    })
                    .catch(function(e){
                        node.warn("Error sending file message " + e);
                        msg.error = e;
                        node.send([null, msg]);
                    });
                return;
            }

            if(!msg.payload) {
                node.error('msg.payload is required', {});
                return;
            }

            msg.contentType = node.contentType || msg.contentType || null;
            node.log("Uploading file " + msg.filename);
            node.server.matrixClient.uploadContent(
                msg.payload, {
                    name: msg.filename || null, // Name to give the file on the server.
                    rawResponse: false, // Return the raw body, rather than parsing the JSON.
                    type: msg.contentType, // Content-type for the upload. Defaults to file.type, or applicaton/octet-stream.
                    onlyContentUri: false // Just return the content URI, rather than the whole body. Defaults to false. Ignored if opts.rawResponse is true.
                })
                .then(function(file){
                    const content = {
                        msgtype: 'm.file',
                        url: file.content_uri,
                        body: msg.body || "",
                    };
                    node.server.matrixClient
                        .sendMessage(msg.topic, content)
                            .then(function(e) {
                                node.log("File message sent: " + e);
                                msg.eventId = e.event_id;
                                node.send([msg, null]);
                            })
                            .catch(function(e){
                                node.warn("Error sending file message " + e);
                                msg.error = e;
                                node.send([null, msg]);
                            });
                }).catch(function(e){
                    node.warn("Error uploading file message " + e);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-send-file", MatrixSendFile);
}