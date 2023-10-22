module.exports = function(RED) {
    function MatrixRoomSettings(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
        this.returnValues = n.returnValues;
        this.rules = n.rules;

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

            let getterErrors = {},
                setterErrors = {};

            if(!Array.isArray(node.rules) || !node.rules.length) {
                node.warn("No rules configured, skipping", msg);
                return msg;
            }

            function getToValue(msg, rule) {
                var value = rule.to;
                if (rule.tot === 'json') {
                    try {
                        value = JSON.parse(rule.to);
                    } catch(e) {
                        throw new Error("Invalid JSON");
                    }
                } else if (rule.tot === 'bin') {
                    try {
                        value = Buffer.from(JSON.parse(rule.to))
                    } catch(e) {
                        throw new Error("Invalid Binary");
                    }
                }
                if (rule.tot === "msg") {
                    value = RED.util.getMessageProperty(msg,rule.to);
                } else if ((rule.tot === 'flow') || (rule.tot === 'global')) {
                    RED.util.evaluateNodeProperty(rule.to, rule.tot, node, msg, (err,value) => {
                        if (err) {
                            throw new Error("Invalid value evaluation");
                        } else {
                            return value;
                        }
                    });
                    return
                } else if (rule.tot === 'date') {
                    value = Date.now();
                } else if (rule.tot === 'jsonata') {
                    RED.util.evaluateJSONataExpression(rule.to,msg, (err, value) => {
                        if (err) {
                            throw new Error("Invalid expression");
                        } else {
                            return value;
                        }
                    });
                    return;
                }
                return value;
            }

            function setToValue(value, rule) {
                if(rule.tot === 'global' || rule.tot === 'flow') {
                    var contextKey = RED.util.parseContextStore(rule.to);
                    if (/\[msg/.test(contextKey.key)) {
                        // The key has a nest msg. reference to evaluate first
                        contextKey.key = RED.util.normalisePropertyExpression(contextKey.key, msg, true)
                    }
                    var target = node.context()[rule.tot];
                    var callback = err => {
                        if (err) {
                            node.error(err, msg);
                            getterErrors[rule.p] = err.message;
                        }
                    }
                    target.set(contextKey.key, value, contextKey.store, callback);
                } else if(rule.tot === 'msg') {
                    if (!RED.util.setMessageProperty(msg, rule.to, value)) {
                        node.warn(RED._("change.errors.no-override",{property:rule.to}));
                    }
                }
            }

            for(let rule of node.rules) {
                // [
                //     {
                //         "t": "set",
                //         "p": "m.room.topic",
                //         "to": "asdf",
                //         "tot": "str"
                //     }, ...
                // ]

                let cachedGetters = {};
                if(rule.t === 'set') {
                    let value;
                    try {
                        value = getToValue(msg, rule);
                        switch(rule.p) {
                            case "m.room.name":
                                await node.server.matrixClient.sendStateEvent(
                                    msg.topic,
                                    "m.room.name",
                                    typeof value === "string"
                                        ? { name: value }
                                        : value);
                                break;
                            case "m.room.topic":
                                if(typeof value === "string") {
                                    await node.server.matrixClient.setRoomTopic(msg.topic, value);
                                } else {
                                    await node.server.matrixClient.sendStateEvent(
                                        msg.topic,
                                        "m.room.topic",
                                        value
                                    );
                                }
                                break;
                            case "m.room.avatar":
                                await node.server.matrixClient.sendStateEvent(
                                    msg.topic,
                                    "m.room.avatar",
                                    typeof value === "string"
                                        ? { "url": value }
                                        : value,
                                    "");
                                break;
                            case "m.room.power_levels":
                                if(typeof value !== 'object') {
                                    setterErrors[rule.p] = "m.room.power_levels content must be object";
                                } else {
                                    await node.server.matrixClient.sendStateEvent(
                                        msg.topic,
                                        "m.room.power_levels",
                                        value,
                                        "");
                                }
                                break;
                            case "m.room.guest_access":
                                await node.server.matrixClient.sendStateEvent(
                                    msg.topic,
                                    "m.room.guest_access",
                                    typeof value === "string"
                                        ? { "guest_access": value }
                                        : value,
                                    "");
                                break;
                            case "m.room.join_rules":
                                if(typeof value !== 'object') {
                                    setterErrors[rule.p] = "m.room.join_rules content must be object";
                                } else {
                                    await node.server.matrixClient.sendStateEvent(
                                        msg.topic,
                                        "m.room.join_rules",
                                        value,
                                        "");
                                }
                                break;
                            case "m.room.canonical_alias":
                                if(typeof value !== 'object') {
                                    setterErrors[rule.p] = "m.room.canonical_alias content must be object";
                                } else {
                                    await node.server.matrixClient.sendStateEvent(
                                        msg.topic,
                                        "m.room.canonical_alias",
                                        value,
                                        "");
                                }
                                break;
                            default:
                                if(typeof value !== 'object') {
                                    setterErrors[rule.p] = "Custom event content must be object";
                                } else {
                                    await node.server.matrixClient.sendStateEvent(
                                        msg.topic,
                                        rule.p,
                                        value,
                                        "");
                                }
                                break;
                        }
                    } catch(e) {
                        setterErrors[rule.p] = e.message;
                    }
                } else if(rule.t === 'get') {
                    let value;
                    if(cachedGetters.hasOwnProperty(rule.p)) {
                        value = cachedGetters[rule.p];
                    } else {
                        try {
                            // we may want to fetch from local storage in the future, this is how to do that
                            // const room = this.getRoom(roomId);
                            // const ev = room.currentState.getStateEvents(EventType.RoomEncryption, "");
                            value = await node.server.matrixClient.getStateEvent(msg.topic, rule.p, "");
                            switch(rule.p) {
                                case "m.room.name":
                                    value = value?.name
                                    break;
                                case "m.room.topic":
                                    value = value?.topic
                                    break;
                                case "m.room.avatar":
                                    value = value?.url
                                    break;
                                case "m.room.guest_access":
                                    value = value?.guest_access;
                                    break;
                            }
                            setToValue(value, rule);
                        } catch(e) {
                            getterErrors[rule.p] = e;
                        }
                    }

                }
            }

            if(Object.keys(setterErrors).length) {
                msg.setter_errors = setterErrors;
            }

            if(Object.keys(getterErrors).length) {
                msg.getter_errors = getterErrors;
            }

            node.send([msg, null]);
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-room-state-events", MatrixRoomSettings);
}