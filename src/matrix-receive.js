module.exports = function(RED) {
    function MatrixReceiveMessage(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.ignoreText = n.ignoreText;
        this.ignoreReactions = n.ignoreReactions;
        this.ignoreFiles = n.ignoreFiles;
        this.ignoreImages = n.ignoreImages;
        this.roomId = n.roomId;
        this.roomIds = this.roomId ? this.roomId.split(',') : [];

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        if (!node.server) {
            node.error("No configuration node");
            return;
        }

        node.server.on("disconnected", function() {
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.server.on("Room.timeline", function(event, room, toStartOfTimeline, data) {
            if (toStartOfTimeline) {
                return; // ignore paginated results
            }
            if (
                event.getType() !== "m.room.message"
                && event.getType() !== "m.reaction"
            ) {
                return; // only keep messages
            }
            if (!event.getSender() || event.getSender() === node.server.userId) {
                return; // ignore our own messages
            }
            if (!event.getUnsigned() || event.getUnsigned().age > 1000) {
                return; // ignore old messages
            }

            // if node has a room ID set we only listen on that room
            if(node.roomIds.length && node.roomIds.indexOf(room.roomId) === -1) {
                return;
            }

            node.log("Received timeline event [" + ((event.getContent().msgtype || event.getType()) || null) + "]: (" + room.name + ") " + event.getSender() + " :: " + event.getContent().body);

            let msg = {
                content: event.getContent(),
                type    : (event.getContent().msgtype || event.getType()) || null,
                payload : event.getContent().body || null,
                userId  : event.getSender(),
                topic   : room.roomId,
                eventId : event.getId(),
                event   : event,
            };

            let knownMessageType = true;
            switch(msg.type) {
                case 'm.text':
                    if(node.ignoreText) return;
                    break;

                case 'm.reaction':
                    if(node.ignoreReactions) return;
                    msg.info = msg.content["m.relates_to"].info;
                    msg.referenceEventId = msg.content["m.relates_to"].event_id;
                    msg.payload = msg.content["m.relates_to"].key;
                    break;

                case 'm.file':
                    if(node.ignoreFiles) return;
                    msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.url);
                    msg.mxc_url = msg.content.url;
                    break;

                case 'm.image':
                    if(node.ignoreImages) return;
                    msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.url);
                    msg.mxc_url = msg.content.url;
                    msg.thumbnail_url = node.server.matrixClient.mxcUrlToHttp(msg.content.info.thumbnail_url);
                    msg.thumbnail_mxc_url = msg.content.info.thumbnail_url;
                    break;

                default:
                    knownMessageType = false;
            }

            if(knownMessageType) {
                node.send(msg);
            } else {
                node.warn("Uknown message type: " + msg.type);
            }
        });
    }
    RED.nodes.registerType("matrix-receive", MatrixReceiveMessage);
}