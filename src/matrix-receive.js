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
        this.acceptAudio = n.acceptAudio;
        this.acceptImages = n.acceptImages;
        this.acceptVideos = n.acceptVideos;
        this.acceptLocations = n.acceptLocations;
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
                    msg.filename = msg.content.filename || msg.content.body;
                    if(msg.encrypted) {
                        msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.file.url);
                        msg.mxc_url = msg.content.file.url;
                    } else {
                        msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.url);
                        msg.mxc_url = msg.content.url;
                    }
                    break;

                case 'm.audio':
                    if(!node.acceptAudio) return;
                    if(msg.encrypted) {
                        msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.file.url);
                        msg.mxc_url = msg.content.file.url;
                    } else {
                        msg.url = node.server.matrixClient.mxcUrlToHttp(msg.content.url);
                        msg.mxc_url = msg.content.url;
                    }

                    if('org.matrix.msc1767.file' in msg.content) {
                        msg.filename = msg.content['org.matrix.msc1767.file'].name;
                        msg.mimetype = msg.content['org.matrix.msc1767.file'].mimetype;
                    }

                    if('org.matrix.msc1767.audio' in msg.content) {
                        msg.duration = msg.content['org.matrix.msc1767.audio'].duration;
                        msg.waveform = msg.content['org.matrix.msc1767.audio'].waveform;
                    }
                    break;

                case 'm.image':
                    if(!node.acceptImages) return;
                    msg.filename = msg.content.filename || msg.content.body;
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


                case 'm.video':
                    if(!node.acceptVideos) return;
                    msg.filename = msg.content.filename || msg.content.body;
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

                case 'm.location':
                    if(!node.acceptLocations) return;
                    msg.geo_uri = msg.content.geo_uri;
                    msg.payload = msg.content.body;
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