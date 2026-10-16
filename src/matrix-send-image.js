const { imageSize } = require('image-size');

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
        node.server.register(node);

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.listen(node, "disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.listen(node, "connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        function sendError(text, msg, error) {
            node.error(text, msg);
            msg.error = error || text;
            node.send([null, msg]);
        }

        // Read a ReadStream or Blob payload into a Buffer. Node's fetch cannot
        // upload a stream without the "duplex" option, which the SDK does not
        // set, so streams used to fail with "duplex option is required".
        async function toUploadable(payload) {
            if (payload && typeof payload.pipe === 'function' && typeof payload.on === 'function') {
                let chunks = [];
                for await (const chunk of payload) {
                    chunks.push(Buffer.from(chunk));
                }
                return Buffer.concat(chunks);
            }
            if (payload && !Buffer.isBuffer(payload) && typeof payload.arrayBuffer === 'function') {
                return Buffer.from(await payload.arrayBuffer());
            }
            return payload;
        }

        node.on("input", async function (msg) {
            try {
                if (! node.server || ! node.server.matrixClient) {
                    sendError("No matrix server selected", msg);
                    return;
                }

                if(!node.server.isConnected()) {
                    sendError("Matrix server connection is currently closed", msg);
                    return;
                }

                msg.topic = node.roomId || msg.topic;
                if(!msg.topic) {
                    sendError("Room must be specified in msg.topic or in configuration", msg);
                    return;
                }

                if(msg.content && msg.type === 'm.image') {
                    try {
                        let e = await node.server.matrixClient.sendMessage(msg.topic, msg.content);
                        node.log("Image message sent: " + e);
                        msg.eventId = e.event_id;
                        node.send([msg, null]);
                    } catch(e) {
                        sendError("Error sending image message: " + e, msg, e);
                    }
                    return;
                }

                if(!msg.payload) {
                    sendError('msg.payload is required', msg);
                    return;
                }

                let payload = await toUploadable(msg.payload);

                // Fill in content.info (#80): clients and bridges (e.g. mautrix)
                // need at least the mimetype to render the image instead of
                // offering a binary download. Detect from the image bytes,
                // falling back to the file name.
                const Mime = (await import('mime')).default;
                let dimensions = null;
                if (Buffer.isBuffer(payload)) {
                    try {
                        dimensions = imageSize(payload);
                    } catch(e) {
                        dimensions = null; // not an image format image-size knows
                    }
                }
                msg.contentType = node.contentType
                    || msg.contentType
                    || (dimensions && dimensions.type && Mime.getType(dimensions.type))
                    || (msg.filename && Mime.getType(msg.filename))
                    || null;
                let info = {};
                if (msg.contentType) {
                    info.mimetype = msg.contentType;
                }
                if (Buffer.isBuffer(payload) || typeof payload === 'string') {
                    info.size = Buffer.byteLength(payload);
                }
                if (dimensions && dimensions.width && dimensions.height) {
                    info.w = dimensions.width;
                    info.h = dimensions.height;
                }

                node.log("Uploading image " + msg.filename);
                let file;
                try {
                    file = await node.server.matrixClient.uploadContent(
                        payload, {
                            name: msg.filename || undefined, // Name to give the file on the server.
                            type: msg.contentType || undefined, // Content-type for the upload. Defaults to applicaton/octet-stream.
                        });
                } catch(e) {
                    sendError("Error uploading image message: " + e, msg, e);
                    return;
                }

                let content = {
                    msgtype: 'm.image',
                    url: file.content_uri,
                    body: msg.body || msg.filename || "Image",
                    info: info,
                };
                if (msg.filename) {
                    content.filename = msg.filename;
                }
                try {
                    let e = await node.server.matrixClient.sendMessage(msg.topic, content);
                    node.log("Image message sent: " + e);
                    msg.eventId = e.event_id;
                    msg.content_uri_mxc = file.content_uri;
                    // Authenticated media URL (the legacy unauthenticated one
                    // 404s on homeservers with authenticated media); downloads
                    // need an "Authorization: Bearer <token>" header.
                    msg.content_uri = node.server.matrixClient.mxcUrlToHttp(file.content_uri, undefined, undefined, undefined, false, true, true)
                        || node.server.matrixClient.mxcUrlToHttp(file.content_uri);
                    node.send([msg, null]);
                } catch(e) {
                    sendError("Error sending image message: " + e, msg, e);
                }
            } catch(e) {
                sendError("Error sending image: " + e, msg, e);
            }
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-send-image", MatrixSendImage);
}
