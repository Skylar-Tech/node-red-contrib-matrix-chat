module.exports = function(RED) {
    function MatrixUserSettings(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
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
                    try {
                        value = RED.util.evaluateNodeProperty(rule.to, rule.tot, node, msg);
                    } catch(e2) {
                        throw new Error("Invalid value evaluation");
                    }
                } else if (rule.tot === 'date') {
                    value = Date.now();
                } else if (rule.tot === 'jsonata') {
                    try {
                        value = RED.util.evaluateJSONataExpression(rule.to,msg);
                    } catch(e3) {
                        throw new Error("Invalid expression");
                    }
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
                            case "display_name":
                                await node.server.matrixClient.setDisplayName(value);
                                break;
                            case "avatar_url":
                                await node.server.matrixClient.setAvatarUrl(typeof value === "string" ? value : "");
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
                            // normalize some simpler events for easier access
                            switch(rule.p) {
                                case "display_name":
                                    value = (await node.server.matrixClient.getProfileInfo(node.server.matrixClient.getUserId(), 'displayname')).displayname || false;
                                    break;
                                case "avatar_url":
                                    value = (await node.server.matrixClient.getProfileInfo(node.server.matrixClient.getUserId(), 'avatar_url')).avatar_url || false;
                                    break;
                            }
                            setToValue(value, rule);
                            cachedGetters[rule.p] = value;
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
    RED.nodes.registerType("matrix-user-settings", MatrixUserSettings);
}