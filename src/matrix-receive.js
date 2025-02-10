module.exports = function(RED) {
    function MatrixReceiveMessage(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.acceptOwnEvents = n.acceptOwnEvents;
        this.acceptText = n.acceptText;
        this.acceptEmotes = n.acceptEmotes;
        this.acceptNotices = n.acceptNotices;
        this.acceptStickers = n.acceptStickers;
        this.acceptReactions = n.acceptReactions;
        this.acceptFiles = n.acceptFiles;
        this.acceptAudio = n.acceptAudio;
        this.acceptImages = n.acceptImages;
        this.acceptVideos = n.acceptVideos;
        this.acceptLocations = n.acceptLocations;
        this.roomId = n.roomId;
        this.roomIds = this.roomId ? this.roomId.split(',').map(s => s.trim()) : [];

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        if (!node.server) {
            node.error("No configuration node", {});
            return;
        }
        node.server.register(node);

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.server.on("Room.timeline", async function(event, room, toStartOfTimeline, removed, data, msg) {
            // if node has a room ID set we only listen on that room
            if (node.roomIds.length && !node.roomIds.includes(room.roomId)) {
                return;
            }

            if (!node.acceptOwnEvents && (!event.getSender() || event.getSender().toLowerCase() === node.server.matrixClient.getUserId().toLowerCase())) {
                node.log(`Ignoring${msg.encrypted ? ' encrypted' : ''} timeline event [${msg.type}]: (${room.name}) ${event.getId()} for reason: own event`);
                return;
            }

            const setUrls = (urlKey, encryptedKey) => {
                const url = msg.encrypted ? msg.content[encryptedKey]?.url : msg.content[urlKey];
                if (url) {
                    msg.url = node.server.matrixClient.mxcUrlToHttp(url);
                    msg.mxc_url = url;
                }
            };

            const setThumbnailUrls = (infoKey) => {
                const thumbnailFile = msg.content.info?.[infoKey];
                const thumbnailUrl = thumbnailFile?.url;
                if (thumbnailUrl) {
                    msg.thumbnail_url = node.server.matrixClient.mxcUrlToHttp(thumbnailUrl);
                    msg.thumbnail_mxc_url = thumbnailUrl;
                }
            };

            switch (msg.type) {
                case 'm.emote':
                    if (!node.acceptEmotes) return;
                    break;

                case 'm.notice':
                    if (!node.acceptNotices) return;
                    break;

                case 'm.text':
                    if (!node.acceptText) return;
                    break;

                case 'm.sticker':
                    if (!node.acceptStickers) return;
                    setThumbnailUrls('thumbnail_url');
                    setUrls('url', 'url');
                    break;

                case 'm.file':
                    if (!node.acceptFiles) return;
                    msg.filename = msg.content.filename || msg.content.body;
                    setUrls('url', 'file');
                    break;

                case 'm.audio':
                    if (!node.acceptAudio) return;
                    setUrls('url', 'file');
                    if ('org.matrix.msc1767.file' in msg.content) {
                        msg.filename = msg.content['org.matrix.msc1767.file'].name;
                        msg.mimetype = msg.content['org.matrix.msc1767.file'].mimetype;
                    }
                    if ('org.matrix.msc1767.audio' in msg.content) {
                        msg.duration = msg.content['org.matrix.msc1767.audio'].duration;
                        msg.waveform = msg.content['org.matrix.msc1767.audio'].waveform;
                    }
                    break;

                case 'm.image':
                    if (!node.acceptImages) return;
                    msg.filename = msg.content.filename || msg.content.body;
                    setUrls('url', 'file');
                    setThumbnailUrls('thumbnail_file');
                    break;

                case 'm.video':
                    if (!node.acceptVideos) return;
                    msg.filename = msg.content.filename || msg.content.body;
                    setUrls('url', 'file');
                    setThumbnailUrls('thumbnail_file');
                    break;

                case 'm.location':
                    if (!node.acceptLocations) return;
                    msg.geo_uri = msg.content.geo_uri;
                    msg.payload = msg.content.body;
                    break;

                case 'm.reaction':
                    if (!node.acceptReactions) return;
                    msg.info = msg.content["m.relates_to"].info;
                    msg.referenceEventId = msg.content["m.relates_to"].event_id;
                    msg.payload = msg.content["m.relates_to"].key;
                    break;

                default:
                    return;
            }

            node.send(msg);
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-receive", MatrixReceiveMessage);
}