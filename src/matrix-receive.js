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

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.server.on("Room.timeline", async function(event, room, toStartOfTimeline, removed, data, msg) {
            // if node has a room ID set we only listen on that room
            if(node.roomIds.length && node.roomIds.indexOf(room.roomId) === -1) {
                return;
            }

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