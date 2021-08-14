module.exports = function(RED) {
    function MatrixSendMessage(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.matrixServer);
        this.room = n.room;

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

            // node.matrixClient.joinRoom(node.room, {syncRoom:false}) // should we really skip syncing the room?
            //     .then(function(joinedRoom) {
            //         node.log("Joined " + node.room);
            //         node.room = joinedRoom.roomId;
            //         node.updateConnectionState(true);
            //     }).catch(function(e) {
            //     node.warn("Error joining " + node.room + ": " + e);
            // });
        });

        node.on("input", function (msg) {
            if (! node.server || ! node.server.matrixClient) {
                node.warn("No matrix server configuration");
                return;
            }

            if(!node.server.isConnected()) {
                node.warn("Matrix server connection is currently closed");
                node.send([null, msg]);
            }

            if (msg.payload) {
                node.log("Sending message " + msg.payload);

                if(!msg.roomId) {
                    msg.roomId = node.room;
                }

                if(!msg.roomId) {
                    node.warn("Room must be specified in msg.roomId or in configuration");
                    return;
                }

                // @todo add checks to make sure required properties are filled out instead of throwing an exception
                switch(msg.type || null) {
                    case 'react':
                        /**
                         * React to another event (message)
                         * msg.roomId - required
                         *
                         */
                        node.server.matrixClient.sendCompleteEvent(
                            msg.roomId,
                            {
                                type: 'm.reaction',
                                content: {
                                    "m.relates_to": {
                                        event_id: msg.eventId,
                                        "key": msg.payload,
                                        "rel_type": "m.annotation"
                                    }
                                }
                            }
                        )
                            .then(function(e) {
                                msg.eventId = e.event_id;
                                node.send([msg, null]);
                            })
                            .catch(function(e){
                                msg.matrixError = e;
                                node.send([null, msg]);
                            });
                        break;

                    case 'image':
                        node.server.matrixClient.uploadContent(
                            msg.image.content, {
                                name: msg.image.filename || null, // Name to give the file on the server.
                                rawResponse: (msg.rawResponse || false), // Return the raw body, rather than parsing the JSON.
                                type: msg.image.type, // Content-type for the upload. Defaults to file.type, or applicaton/octet-stream.
                                onlyContentUri: false // Just return the content URI, rather than the whole body. Defaults to false. Ignored if opts.rawResponse is true.
                            }).then(function(file){
                                node.server.matrixClient
                                    .sendImageMessage(msg.roomId, file.content_uri, {}, msg.payload)
                                        .then(function(imgResp) {
                                            node.log("Image message sent: " + imgResp);
                                            msg.eventId = e.eventId;
                                            node.send([msg, null]);
                                        })
                                        .catch(function(e){
                                            node.warn("Error sending image message " + e);
                                            msg.matrixError = e;
                                            node.send([null, msg]);
                                        });
                            }).catch(function(e){
                                node.warn("Error uploading image message " + e);
                                msg.matrixError = e;
                                node.send([null, msg]);
                            });
                        break;

                    case 'file':
                        if(!msg.file) {
                            node.error('msg.file must be defined to send a file');
                        }

                        if(!msg.file.type) {
                            node.error('msg.file.type must be set to a valid content-type header (i.e. application/pdf)');
                        }

                        node.server.matrixClient.uploadContent(
                            msg.file.content, {
                                name: msg.file.filename || null, // Name to give the file on the server.
                                rawResponse: (msg.rawResponse || false), // Return the raw body, rather than parsing the JSON.
                                type: msg.file.type, // Content-type for the upload. Defaults to file.type, or applicaton/octet-stream.
                                onlyContentUri: false // Just return the content URI, rather than the whole body. Defaults to false. Ignored if opts.rawResponse is true.
                            }).then(function(file){
                                const content = {
                                    msgtype: 'm.file',
                                    url: file.content_uri,
                                    body: msg.payload,
                                };
                                node.server.matrixClient
                                    .sendMessage(msg.roomId, content)
                                        .then(function(imgResp) {
                                            node.log("File message sent: " + imgResp);
                                            msg.eventId = e.eventId;
                                            node.send([msg, null]);
                                        })
                                        .catch(function(e){
                                            node.warn("Error sending file message " + e);
                                            msg.matrixError = e;
                                            node.send([null, msg]);
                                        });
                            }).catch(function(e){
                                node.warn("Error uploading file message " + e);
                                msg.matrixError = e;
                                node.send([null, msg]);
                            });
                        break;

                    default: // default text message
                        node.server.matrixClient.sendTextMessage(msg.roomId, msg.payload.toString())
                            .then(function(e) {
                                node.log("Message sent: " + msg.payload);
                                msg.eventId = e.eventId;
                                node.send([msg, null]);
                            }).catch(function(e){
                                node.warn("Error sending message " + e);
                                msg.matrixError = e;
                                node.send([null, msg]);
                            });
                        break;
                }
            } else {
                node.warn("msg.payload is empty");
            }
        });
    }
    RED.nodes.registerType("matrix-send", MatrixSendMessage);
}