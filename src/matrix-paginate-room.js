module.exports = function(RED) {
    function MatrixReceiveMessage(n) {
        RED.nodes.createNode(this, n);

        let node = this;
        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomType = n.roomType;
        this.roomValue = n.roomValue;
        this.paginateBackwardsType = n.paginateBackwardsType;
        this.paginateBackwardsValue = n.paginateBackwardsValue;
        this.paginateKeyType = n.paginateKeyType;
        this.paginateKeyValue = n.paginateKeyValue;
        this.pageSizeType = n.pageSizeType;
        this.pageSizeValue = n.pageSizeValue;
        this.timelineWindows = new Map();

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

        node.on("input", async function (msg) {
            const {TimelineWindow, RelationType, Filter} = await import("matrix-js-sdk");
            const crypto = await import('crypto');

            if (! node.server || ! node.server.matrixClient) {
                node.error("No matrix server selected", msg);
                return;
            }

            function getToValue(msg, type, property) {
                let value = property;
                if (type === "msg") {
                    value = RED.util.getMessageProperty(msg, property);
                } else if ((type === 'flow') || (type === 'global')) {
                    try {
                        value = RED.util.evaluateNodeProperty(property, type, node, msg);
                    } catch(e2) {
                        throw new Error("Invalid value evaluation");
                    }
                } else if(type === "bool") {
                    value = (property === 'true');
                } else if(type === "num") {
                    value = Number(property);
                }
                return value;
            }

            function setToValue(value, type, property) {
                if(type === 'global' || type === 'flow') {
                    var contextKey = RED.util.parseContextStore(property);
                    if (/\[msg/.test(contextKey.key)) {
                        // The key has a nest msg. reference to evaluate first
                        contextKey.key = RED.util.normalisePropertyExpression(contextKey.key, msg, true)
                    }
                    var target = node.context()[type];
                    var callback = err => {
                        if (err) {
                            node.error(err, msg);
                            getterErrors[rule.p] = err.message;
                        }
                    }
                    target.set(contextKey.key, value, contextKey.store, callback);
                } else if(type === 'msg') {
                    if (!RED.util.setMessageProperty(msg, property, value)) {
                        node.warn(RED._("change.errors.no-override",{property:property}));
                    }
                }
            }

            try {
                let roomId = getToValue(msg, node.roomType, node.roomValue),
                    paginateBackwards = getToValue(msg, node.paginateBackwardsType, node.paginateBackwardsValue),
                    pageSize = getToValue(msg, node.pageSizeType, node.pageSizeValue),
                    pageKey = getToValue(msg, node.paginateKeyType, node.paginateKeyValue);

                let room = node.server.matrixClient.getRoom(roomId);

                if(!room) {
                    throw new Error(`Room ${roomId} does not exist`);
                }
                if(pageSize > node.server.initialSyncLimit) {
                    throw new Error(`Page size=${pageSize} cannot exceed initialSyncLimit=${node.server.initialSyncLimit}`);
                }
                if(!pageKey) {
                    pageKey = crypto.randomUUID();
                    setToValue(pageKey, node.paginateKeyType, node.paginateKeyValue);
                }
                let timelineWindow = node.timelineWindows.get(pageKey),
                    moreMessages = true;
                if(!timelineWindow) {
                    let timelineSet = room.getUnfilteredTimelineSet();
                    // node.debug(JSON.stringify(timelineSet.getFilter()));

                    // MatrixClient's option initialSyncLimit gets set to the filter we are using
                    // so override that value with our pageSize
                    timelineWindow = new TimelineWindow(node.server.matrixClient, timelineSet);
                    await timelineWindow.load(msg.eventId || null, pageSize);
                    node.timelineWindows.set(pageKey, timelineWindow);
                } else {
                    moreMessages = await timelineWindow.paginate(paginateBackwards ? 'b' : 'f', pageSize); // b for backwards f for forwards
                    if(moreMessages) {
                        await timelineWindow.unpaginate(pageSize, !paginateBackwards);
                    }
                }

                // MatrixEvent objects are massive so this throws an encode error for the string being too long
                // since msg objects convert to JSON
                // msg.payload = moreMessages ? timelineWindow.getEvents() : false;

                msg.payload = false;
                msg.start = timelineWindow.getTimelineIndex('b')?.index;
                msg.end = timelineWindow.getTimelineIndex('f')?.index;
                if(moreMessages) {
                    msg.payload = timelineWindow.getEvents().map(function(event) {
                        return {
                            encrypted    : event.isEncrypted(),
                            redacted     : event.isRedacted(),
                            content      : event.getContent(),
                            type         : (event.getContent()['msgtype'] || event.getType()) || null,
                            payload      : (event.getContent()['body'] || event.getContent()) || null,
                            isThread     : event.getContent()?.['m.relates_to']?.rel_type === RelationType.Thread,
                            mentions     : event.getContent()["m.mentions"] || null,
                            userId       : event.getSender(),
                            // user         : node.matrixClient.getUser(event.getSender()),
                            topic        : event.getRoomId(),
                            eventId      : event.getId(),
                            event        : event.getEffectiveEvent(),
                        };
                    });
                }
                node.send([msg, null]);
            } catch(e) {
                msg.error = `Room pagination error: ${e}`;
                node.error(msg.error, msg);
                node.send([null, msg]);
            }
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-paginate-room", MatrixReceiveMessage);
}