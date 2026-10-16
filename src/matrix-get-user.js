module.exports = function(RED) {
    function MatrixGetUser(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.userType = n.userType || "msg";
        this.userValue = n.userValue || "userId";
        this.propertyType = n.propertyType || "msg";
        this.propertyValue = n.propertyValue || "user";

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
                        }
                    }
                    target.set(contextKey.key, value, contextKey.store, callback);
                } else if(type === 'msg') {
                    if (!RED.util.setMessageProperty(msg, property, value)) {
                        node.warn(RED._("change.errors.no-override",{property:property}));
                    }
                }
            }

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

            let userId;
            try {
                userId = getToValue(msg, node.userType, node.userValue);
            } catch(e) {
                msg.error = "Failed getting userId: " + e.message;
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }
            if(!userId) {
                msg.error = "Missing userId";
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            let user = null;
            try {
                user = node.server.matrixClient.getUser(userId);
            } catch(e) {
                msg.error = "Failed getting user: " + e.message;
                node.error(msg.error, msg);
                node.send([null, msg]);
                return;
            }

            if(!user) {
                // failed to fetch from local storage, try to fetch data from server
                let user2 = {};

                try {
                    let profileInfo = await node.server.matrixClient.getProfileInfo(userId);
                    if(profileInfo && Object.keys(profileInfo).length > 0) {
                        user2.displayName = profileInfo.displayname;
                        user2.avatarUrl = profileInfo.avatar_url;
                    }

                    // Presence is optional: homeservers refuse it (403) for users
                    // we share no room with, or have it disabled entirely.
                    let presence = null;
                    try {
                        presence = await node.server.matrixClient.getPresence(userId);
                    } catch(e) {
                        presence = null;
                    }
                    if(presence && Object.keys(presence).length > 0) {
                        user2.currentlyActive = presence.currently_active;
                        user2.lastActiveAgo = presence.last_active_ago;
                        user2.presenceStatusMsg = presence.status_msg;
                        user2.presence = presence.presence;
                    }

                    if(Object.keys(user2).length > 0) {
                        user2.userId = userId;
                        setToValue(user2, node.propertyType, node.propertyValue);
                        node.send([msg, null]);
                        return;
                    }
                } catch(e) {
                    msg.error = "Failed getting user: " + e.message;
                    node.error(msg.error, msg);
                    node.send([null, msg]);
                    return;
                }
            }

            // A plain copy of the SDK's cached User (without its private
            // underscore fields), so changes made by the flow cannot alter the
            // SDK's cache or strip the User's event listeners.
            let userCopy = null;
            if(user) {
                userCopy = {};
                Object.keys(user).forEach(function(key) {
                    if(!/^_/.test(key)) {
                        userCopy[key] = user[key];
                    }
                });
            }
            setToValue(userCopy, node.propertyType, node.propertyValue);
            node.send([msg, null]);
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-get-user", MatrixGetUser);
}