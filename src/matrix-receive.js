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

            node.server.matrixClient.on("Room.timeline", function(event, room, toStartOfTimeline, data) {
                console.log("Room.timeline", [event, room]);
                if (toStartOfTimeline) {
                    console.log("MESSAGED SKIPPED: toStartOfTimeline");
                    return; // ignore paginated results
                }
                if (
                    event.getType() !== "m.room.message"
                    && event.getType() !== "m.reaction"
                ) {
                    console.log("MESSAGED SKIPPED: TYPE");
                    return; // only keep messages
                }
                if (!event.getSender() || event.getSender() === node.server.userId) {
                    console.log("MESSAGED SKIPPED: SENDER");
                    return; // ignore our own messages
                }
                if (!event.getUnsigned() || event.getUnsigned().age > 1000) {
                    console.log("MESSAGED SKIPPED: UNSIGNED");
                    return; // ignore old messages
                }

                // if node has a room ID set we only listen on that room
                if(node.roomId) {
                    let roomIds = node.roomId.split(',');

                    if(roomIds.indexOf(msg.roomId) === -1) {
                        return;
                    }
                }

                let content = event.getContent(),
                    msg = {};

                msg.type = (content.msgtype || event.getType()) || null;
                msg.payload = event.getContent().body;
                msg.sender  = event.getSender();
                msg.roomId  = room.roomId;
                msg.eventId = event.getId();
                msg.event   = event;

                node.log("Received chat message [" + msg.type + "]: (" + room.name + ") " + event.getSender() + " :: " + event.getContent().body);

                switch(msg.type) {
                    case 'm.text':
                        if(node.ignoreText) return;
                        break;

                    case 'm.reaction':
                        if(node.ignoreReactions) return;
                        msg.info = event.getContent()["m.relates_to"].info;
                        msg.eventId = event.getContent()["m.relates_to"].event_id;
                        msg.payload = event.getContent()["m.relates_to"].key;
                        break;

                    case 'm.file':
                        if(node.ignoreFiles) return;
                        msg.file = {
                            info: event.getContent().info,
                            url: node.server.matrixClient.mxcUrlToHttp(event.getContent().url)
                        };
                        break;

                    case 'm.image':
                        if(node.ignoreImages) return;
                        msg.image = {
                            info: event.getContent().info,
                            url: node.server.matrixClient.mxcUrlToHttp(event.getContent().url),
                            thumbnail_url: node.server.matrixClient.mxcUrlToHttp(event.getContent().info.thumbnail_url)
                        };
                        break;
                }

                node.send(msg);
            });
        });
    }
    RED.nodes.registerType("matrix-receive", MatrixReceiveMessage);
}