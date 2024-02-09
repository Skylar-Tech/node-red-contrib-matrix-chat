const {RelationType} = require("matrix-js-sdk");

module.exports = function(RED) {
    function MatrixSendImage(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;
        this.messageType = n.messageType;
        this.messageFormat = n.messageFormat;
        this.replaceMessage = n.replaceMessage;
        this.message = n.message;
        this.threadReplyType = n.threadReplyType || null;
        this.threadReplyValue = n.threadReplyValue || null;

        // taken from https://github.com/matrix-org/synapse/blob/master/synapse/push/mailer.py
        this.allowedTags = [
            "font", // custom to matrix for IRC-style font coloring
            "del",  // for markdown
            // deliberately no h1/h2 to stop people shouting.
            "h3",
            "h4",
            "h5",
            "h6",
            "blockquote",
            "p",
            "a",
            "ul",
            "ol",
            "nl",
            "li",
            "b",
            "i",
            "u",
            "strong",
            "em",
            "strike",
            "code",
            "hr",
            "br",
            "div",
            "table",
            "thead",
            "caption",
            "tbody",
            "tr",
            "th",
            "td",
            "pre",
        ];

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

        node.on("input", function (msg) {
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

            let msgType = node.messageType,
                msgFormat = node.messageFormat,
                threadReply = getToValue(msg, node.threadReplyType, node.threadReplyValue);

            if (!node.server || !node.server.matrixClient) {
                node.warn("No matrix server selected");
                return;
            }

            if(!node.server.isConnected()) {
                node.error("Matrix server connection is currently closed", msg);
                node.send([null, msg]);
                return;
            }

            msg.topic = node.roomId || msg.topic;
            if(!msg.topic) {
                node.warn("Room must be specified in msg.topic or in configuration");
                return;
            }

            let payload = n.message || msg.payload;
            if(!payload) {
                node.error('msg.payload must be defined or the message configured on the node.', msg);
                return;
            }

            let content = null;
            if(typeof payload === 'object') {
                content = payload;
            } else {
                if(msgType === 'msg.type') {
                    if(!msg.type) {
                        node.error("msg.type type is set to be passed in via msg.type but was not defined", msg);
                        return;
                    }
                    msgType = msg.type;
                }

                if(msgFormat === 'msg.format') {
                    if(!msg.format) {
                        node.error("Message format is set to be passed in via msg.format but was not defined", msg);
                        return;
                    }
                    msgFormat = msg.format;
                }

                content = {
                    msgtype: msgType,
                    body: payload.toString()
                };

                if(msgFormat === 'html') {
                    content.format = "org.matrix.custom.html";
                    content.formatted_body =
                        (typeof msg.formatted_payload !== 'undefined' && msg.formatted_payload)
                            ? msg.formatted_payload.toString()
                            : payload.toString();
                }

                if((node.replaceMessage || msg.replace) && msg.eventId) {
                    content['m.new_content'] = {
                        msgtype: content.msgtype,
                        body: content.body
                    };
                    if('format' in content) {
                        content['m.new_content']['format'] = content['format'];
                    }
                    if('formatted_body' in content) {
                        content['m.new_content']['formatted_body'] = content['formatted_body'];
                    }

                    content['m.relates_to'] = {
                        rel_type: RelationType.Replace,
                        event_id: msg.eventId
                    };
                    content['body'] = ' * ' + content['body'];
                } else if(threadReply) {
                    // if incoming message is a reply to a thread we fetch the thread parent from the m.relates_to property
                    // otherwise fallback to msg.eventId
                    let threadParent = (msg?.content?.['m.relates_to']?.rel_type === RelationType.Thread ? msg?.content?.['m.relates_to']?.event_id : null) || msg.eventId;
                    if(threadParent) {
                        content["m.relates_to"] = {
                            "rel_type": RelationType.Thread,
                            "event_id": threadParent,
                            "is_falling_back": true,
                        };
                        if(msg.eventId !== threadParent) {
                            content["m.relates_to"]["m.in_reply_to"] = {
                                "event_id": msg.eventId
                            };
                        }
                    }
                }
            }

            node.server.matrixClient.sendMessage(msg.topic, content)
                .then(function(e) {
                    node.log("Message sent: " + payload);
                    msg.eventId = e.event_id;
                    node.log(JSON.stringify(e));
                    node.send([msg, null]);
                })
                .catch(function(e){
                    node.warn("Error sending message " + e);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-send-message", MatrixSendImage);
}