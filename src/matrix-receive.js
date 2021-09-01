module.exports = function(RED) {
    function MatrixReceiveMessage(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.acceptText = n.acceptText;
        this.acceptEmotes = n.acceptEmotes;
        this.acceptStickers = n.acceptStickers;
        this.acceptReactions = n.acceptReactions;
        this.acceptFiles = n.acceptFiles;
        this.acceptImages = n.acceptImages;
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

        node.server.on("Room.timeline", async function(event, room, toStartOfTimeline, data) {
            if (toStartOfTimeline) {
                return; // ignore paginated results
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

            try {
                await node.server.matrixClient.decryptEventIfNeeded(event);
            } catch (error) {
                node.error(error);
                return;
            }

            let msg = {
                encrypted : event.isEncrypted(),
                redacted  : event.isRedacted(),
                content   : event.getContent(),
                type      : (event.getContent()['msgtype'] || event.getType()) || null,
                payload   : (event.getContent()['body'] || event.getContent()) || null,
                userId    : event.getSender(),
                topic     : event.getRoomId(),
                eventId   : event.getId(),
                event     : event,
            };

            node.log("Received" + (msg.encrypted ? ' encrypted' : '') +" timeline event [" + msg.type + "]: (" + room.name + ") " + event.getSender() + " :: " + msg.content.body);

            switch(msg.type) {
                case 'm.emote':
                    if(!node.acceptEmotes) return;
                    break;

                case 'm.text':
                    if(!node.acceptText) return;
                    break;

                case 'm.sticker':
                    if(!node.acceptStickers) return;
                    if(msg.content.info) {
                        if(msg.content.info.thumbnail_url) {
                            msg.thumbnail_url = node.server.matrixClient.mxcUrlToHttp(msg.content.info.thumbnail_url);
                            msg.thumbnail_mxc_url = msg.content.info.thumbnail_url;
                        }

                        if(msg.content.url) {
                            msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.url);
                            msg.mxc_url = msg.content.url;
                        }
                    }
                    break;

                case 'm.file':
                    if(!node.acceptFiles) return;
                    if(msg.encrypted) {
                        msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.file.url);
                        msg.mxc_url = msg.content.file.url;
                    } else {
                        msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.url);
                        msg.mxc_url = msg.content.url;
                    }
                    break;

                case 'm.image':
                    if(!node.acceptImages) return;

                    if(msg.encrypted) {
                        msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.file.url);
                        msg.mxc_url = msg.content.file.url;
                        msg.thumbnail_url = node.server.matrixClient.mxcUrlToHttp(msg.content.info.thumbnail_file.url);
                        msg.thumbnail_mxc_url = msg.content.info.thumbnail_file.url;
                    } else {
                        msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.url);
                        msg.mxc_url = msg.content.url;
                        msg.thumbnail_url = node.server.matrixClient.mxcUrlToHttp(msg.content.info.thumbnail_url);
                        msg.thumbnail_mxc_url = msg.content.info.thumbnail_url;
                    }
                    break;

                case 'm.reaction':
                    if(!node.acceptReactions) return;
                    msg.info = msg.content["m.relates_to"].info;
                    msg.referenceEventId = msg.content["m.relates_to"].event_id;
                    msg.payload = msg.content["m.relates_to"].key;
                    break;

                default:
                    // node.warn("Unknown event type: " + msg.type);
                    return;
            }

            node.send(msg);
        });
    }
    RED.nodes.registerType("matrix-receive", MatrixReceiveMessage);
}