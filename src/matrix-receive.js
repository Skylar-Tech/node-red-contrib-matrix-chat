// Parse an RFC 5870 geo URI into {latitude, longitude, altitude?}.
// Returns null if the URI is missing or malformed.
function parseGeoUri(uri) {
    if (typeof uri !== "string" || uri.indexOf("geo:") !== 0) return null;
    // strip any ";u=..." / ";crs=..." parameters
    const body = uri.slice(4).split(";")[0];
    const parts = body.split(",").map(function(s) { return parseFloat(s.trim()); });
    if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
    const result = { latitude: parts[0], longitude: parts[1] };
    if (parts.length >= 3 && Number.isFinite(parts[2])) result.altitude = parts[2];
    return result;
}

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

        node.server.listen(node, "disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.listen(node, "connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.server.listen(node, "Room.timeline", async function(event, room, toStartOfTimeline, removed, data, sharedMsg) {
            // This runs inside the SDK's event emission; an exception thrown
            // here would become an unhandled rejection and can stop Node-RED.
            try {
                handleTimelineEvent(event, room, sharedMsg);
            } catch(e) {
                // a small msg for Catch nodes, so a Catch flow cannot modify the shared msg
                node.error("Failed to process timeline event " + (event && event.getId ? event.getId() : "") + ": " + e, {
                    topic: sharedMsg && sharedMsg.topic, eventId: sharedMsg && sharedMsg.eventId,
                    userId: sharedMsg && sharedMsg.userId, type: sharedMsg && sharedMsg.type,
                });
            }
        });

        function handleTimelineEvent(event, room, sharedMsg) {
            // if node has a room ID set we only listen on that room
            if (node.roomIds.length && !node.roomIds.includes(room.roomId)) {
                return;
            }

            // Every receive node gets the same msg from the config node, so
            // work on a private copy: otherwise one flow changing its msg (or
            // this node setting msg.url/payload) leaks into every other
            // receive node's flow, and into the SDK's own event content
            // (#144). The live MatrixEvent stays shared; deep-cloning it would
            // copy the client it references.
            const { event: liveEvent, ...plain } = sharedMsg;
            const msg = RED.util.cloneMessage(plain);
            msg.event = liveEvent;

            if (!node.acceptOwnEvents && (!event.getSender() || event.getSender().toLowerCase() === node.server.matrixClient.getUserId().toLowerCase())) {
                node.log(`Ignoring${msg.encrypted ? ' encrypted' : ''} timeline event [${msg.type}]: (${room.name}) ${event.getId()} for reason: own event`);
                return;
            }

            const setAuthHeaders = () => {
                const accessToken = node.server.matrixClient.getAccessToken?.();
                if (accessToken) {
                    msg.headers = {
                        ...(msg.headers || {}),
                        Authorization: `Bearer ${accessToken}`,
                    };
                }
            };

            const setUrls = (urlKey, encryptedKey) => {
                // Detect encrypted vs plain media by shape, not by whether the
                // event is encrypted: an encrypted event can carry plain media
                // (stickers always do, some clients and bridges do for files),
                // where content.url is the mxc string.
                const url = msg.content[encryptedKey]?.url || msg.content[urlKey];
                if (typeof url === 'string' && url) {
                    const authenticatedUrl = node.server.matrixClient.mxcUrlToHttp(
                        url,
                        undefined,
                        undefined,
                        undefined,
                        false,
                        true,
                        true,
                    );
                    msg.url = authenticatedUrl || node.server.matrixClient.mxcUrlToHttp(url);
                    msg.mxc_url = url;
                    setAuthHeaders();
                }
            };

            const setThumbnailUrls = () => {
                const info = msg.content.info;
                if (!info) return;
                // A thumbnail is either encrypted - info.thumbnail_file, an
                // EncryptedFile object whose .url holds the mxc - or unencrypted
                // - info.thumbnail_url, a plain mxc string. Detect by shape so
                // both image/video and encrypted/unencrypted events resolve a
                // thumbnail (the old code only ever read an object .url, so
                // unencrypted thumbnails were silently dropped).
                const thumbnailUrl = info.thumbnail_file?.url || info.thumbnail_url;
                if (typeof thumbnailUrl !== 'string' || !thumbnailUrl) return;
                const authenticatedThumbnailUrl = node.server.matrixClient.mxcUrlToHttp(
                    thumbnailUrl,
                    undefined,
                    undefined,
                    undefined,
                    false,
                    true,
                    true,
                );
                msg.thumbnail_url = authenticatedThumbnailUrl || node.server.matrixClient.mxcUrlToHttp(thumbnailUrl);
                msg.thumbnail_mxc_url = thumbnailUrl;
                setAuthHeaders();
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
                    setThumbnailUrls();
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
                    msg.filename = msg.content['org.matrix.msc1767.file']?.name || msg.content.filename || msg.content.body;
                    msg.mimetype = msg.content['org.matrix.msc1767.file']?.mimetype || msg.content.info?.mimetype;
                    if ('org.matrix.msc1767.audio' in msg.content) {
                        msg.duration = msg.content['org.matrix.msc1767.audio'].duration;
                        msg.waveform = msg.content['org.matrix.msc1767.audio'].waveform;
                    }
                    break;

                case 'm.image':
                    if (!node.acceptImages) return;
                    msg.filename = msg.content.filename || msg.content.body;
                    setUrls('url', 'file');
                    setThumbnailUrls();
                    break;

                case 'm.video':
                    if (!node.acceptVideos) return;
                    msg.filename = msg.content.filename || msg.content.body;
                    setUrls('url', 'file');
                    setThumbnailUrls();
                    break;

                case 'm.location': {
                    if (!node.acceptLocations) return;
                    msg.geo_uri = msg.content.geo_uri;
                    msg.payload = msg.content.body;
                    // Surface the structured location fields at the top level
                    // so a `matrix-send-location` node wired straight to this
                    // output resends the same location.  Both the stable
                    // (m.location / m.asset / m.ts) and the MSC3488-prefixed
                    // namespaces are checked, since Element currently emits
                    // the prefixed form even though the spec is stable.
                    const loc   = msg.content["m.location"] || msg.content["org.matrix.msc3488.location"] || {};
                    const asset = msg.content["m.asset"]    || msg.content["org.matrix.msc3488.asset"]    || {};
                    let ts = msg.content["m.ts"];
                    if (typeof ts !== "number") ts = msg.content["org.matrix.msc3488.ts"];
                    const coords = parseGeoUri(loc.uri || msg.geo_uri);
                    if (coords) {
                        msg.latitude  = coords.latitude;
                        msg.longitude = coords.longitude;
                        if (coords.altitude !== undefined) msg.altitude = coords.altitude;
                    }
                    if (loc.description) msg.description = loc.description;
                    msg.assetType = asset.type || "m.self";
                    if (typeof ts === "number") msg.timestamp = ts;
                    break;
                }

                case 'm.reaction': {
                    if (!node.acceptReactions) return;
                    // a redacted or malformed reaction has no m.relates_to
                    const relation = msg.content["m.relates_to"];
                    if (!relation) return;
                    msg.info = relation.info;
                    msg.referenceEventId = relation.event_id;
                    msg.payload = relation.key;
                    break;
                }

                default:
                    return;
            }

            node.send(msg);
        }

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-receive", MatrixReceiveMessage);
}
