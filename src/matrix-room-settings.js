module.exports = function(RED) {
    function MatrixRoomSettings(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
        this.returnValues = n.returnValues;

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

        node.on("input", async function (msg) {
            if (! node.server || ! node.server.matrixClient) {
                msg.error = "No matrix server selected";
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            if(!node.server.isConnected()) {
                msg.error = "Matrix server connection is currently closed";
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            msg.topic = node.roomId || msg.topic;
            if(!msg.topic) {
                msg.error = "Room must be specified in msg.topic or in configuration";
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            let errors = {},
                payload = {};

            if(msg.payload?.name) {
                try {
                    await node.server.matrixClient.setRoomName(msg.topic, msg.payload.name);
                } catch(e) {
                    node.error("Set room name failed: " + e.message, msg);
                    errors.name = e.message;
                }
            }

            if(msg.payload?.topic) {
                try {
                    await node.server.matrixClient.setRoomTopic(msg.topic, msg.payload.topic);
                } catch(e) {
                    node.error("Set room topic failed: " + e.message, msg);
                    errors.topic = e.message;
                }
            }

            if(msg.payload?.avatar) {
                try {
                    await node.server.matrixClient.sendStateEvent(
                        msg.topic,
                        "m.room.avatar",
                        {
                            "info": msg.payload?.avatar_info || undefined,
                            "url": msg.payload.avatar
                        },
                        "");
                } catch(e) {
                    node.error("Set room avatar failed: " + e.message, msg);
                    errors.topic = e.message;
                }
            }

            if(Object.keys(errors).length) {
                msg.errors = errors;
            }

            if(node.returnValues) {
                // return current settings
                let join_rules = await node.server.matrixClient.getStateEvent(msg.topic, "m.room.join_rules", "");
                msg.payload = {
                    "name": (await node.server.matrixClient.getStateEvent(msg.topic, "m.room.name", ""))?.name,
                    "topic": (await node.server.matrixClient.getStateEvent(msg.topic, "m.room.topic", ""))?.topic,
                    "avatar": (await node.server.matrixClient.getStateEvent(msg.topic, "m.room.avatar", ""))?.url,
                    "encrypted": node.server.matrixClient.isRoomEncrypted(msg.topic),
                    "power_levels": await node.server.matrixClient.getStateEvent(msg.topic, "m.room.power_levels", ""),
                    "aliases": (await node.server.matrixClient.getLocalAliases(msg.topic))?.aliases,
                    "guest_access": (await node.server.matrixClient.getStateEvent(msg.topic, "m.room.guest_access", ""))?.guest_access,
                    "join_rule": join_rules?.join_rule,
                    "join_allow_rules": join_rules?.allow_rules
                };
            }

            node.send([msg, null]);
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-room-settings", MatrixRoomSettings);
}