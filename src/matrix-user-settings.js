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

        node.server.listen(node, "disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.listen(node, "connected", function() {
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

            let getterErrors = {},
                setterErrors = {};

            if(!Array.isArray(node.rules) || !node.rules.length) {
                node.warn("No rules configured, skipping", msg);
                node.send([msg, null]);
                return;
            }

            async function getToValue(msg, rule) {
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
                    let expr;
                    try {
                        expr = RED.util.prepareJSONataExpression(rule.to, node);
                    } catch(e3) {
                        throw new Error("Invalid expression: " + e3.message);
                    }
                    value = await new Promise(function(resolve, reject) {
                        RED.util.evaluateJSONataExpression(expr, msg, function(err, result) {
                            if (err) {
                                reject(new Error("Invalid expression: " + err.message));
                            } else {
                                resolve(result);
                            }
                        });
                    });
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

            // Presence and the status message are one setting on the server,
            // which rate limits changes to it, so a node that sets both sends
            // them in one request. The part not being set is kept (the server
            // clears a missing status message).
            async function setPresence(changes) {
                const client = node.server.matrixClient;
                const current = await client.getPresence(client.getUserId()).catch(function() { return {}; });
                const opts = {
                    presence: current.presence || "online",
                    status_msg: current.status_msg || undefined,
                };
                if ("presence" in changes) {
                    if (!["online", "unavailable", "offline"].includes(changes.presence)) {
                        throw new Error(`presence must be "online", "unavailable" or "offline", got ${JSON.stringify(changes.presence)}`);
                    }
                    opts.presence = changes.presence;
                }
                if ("status_msg" in changes) {
                    const value = changes.status_msg;
                    opts.status_msg = (value === undefined || value === null || value === false) ? "" : String(value);
                }
                await client.setPresence(opts);
                // A running client's /sync reports the bot as online and would
                // undo "unavailable" or "offline" within seconds, so have it
                // report the chosen presence instead.
                if (typeof client.setSyncPresence === "function") {
                    await client.setSyncPresence(opts.presence);
                }
            }
            let presenceRulesDone = new Set();

            let cachedGetters = {};
            for(let rule of node.rules) {
                // [
                //     {
                //         "t": "set",
                //         "p": "m.room.topic",
                //         "to": "asdf",
                //         "tot": "str"
                //     }, ...
                // ]

                if(rule.t === 'set') {
                    let value;
                    try {
                        value = await getToValue(msg, rule);
                        switch(rule.p) {
                            case "display_name":
                                await node.server.matrixClient.setDisplayName(value);
                                break;
                            case "avatar_url":
                                await node.server.matrixClient.setAvatarUrl(typeof value === "string" ? value : "");
                                break;
                            case "presence":
                            case "status_msg": {
                                if (presenceRulesDone.has(rule)) {
                                    break; // already sent with the other one
                                }
                                // pick up a later rule setting the other half
                                const other = rule.p === "presence" ? "status_msg" : "presence";
                                const otherRule = node.rules.find(function(r) {
                                    return r.t === "set" && r.p === other && !presenceRulesDone.has(r) && node.rules.indexOf(r) > node.rules.indexOf(rule);
                                });
                                const changes = { [rule.p]: value };
                                if (otherRule) {
                                    presenceRulesDone.add(otherRule);
                                    try {
                                        changes[other] = await getToValue(msg, otherRule);
                                    } catch(e) {
                                        setterErrors[other] = e.message;
                                        delete changes[other];
                                    }
                                }
                                try {
                                    await setPresence(changes);
                                } catch(e) {
                                    if (otherRule && other in changes) {
                                        setterErrors[other] = e.message;
                                    }
                                    throw e;
                                }
                                break;
                            }
                        }
                    } catch(e) {
                        setterErrors[rule.p] = e.message;
                    }
                    // a later getter must not return what was cached before this set
                    cachedGetters = {};
                } else if(rule.t === 'get') {
                    let value;
                    if(cachedGetters.hasOwnProperty(rule.p)) {
                        value = cachedGetters[rule.p];
                        setToValue(value, rule);
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
                                case "presence":
                                    value = (await node.server.matrixClient.getPresence(node.server.matrixClient.getUserId())).presence || false;
                                    break;
                                case "status_msg":
                                    value = (await node.server.matrixClient.getPresence(node.server.matrixClient.getUserId())).status_msg || false;
                                    break;
                            }
                            setToValue(value, rule);
                            cachedGetters[rule.p] = value;
                        } catch(e) {
                            getterErrors[rule.p] = (e && e.message) || String(e);
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