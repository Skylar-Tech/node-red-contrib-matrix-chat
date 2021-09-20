module.exports = function(RED) {
    function MatrixJoinRoom(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;

        if(!this.server) {
            node.error('Server must be configured on the node.');
            return;
        }

        this.encodeUri = function(pathTemplate, variables) {
            for (const key in variables) {
                if (!variables.hasOwnProperty(key)) {
                    continue;
                }
                pathTemplate = pathTemplate.replace(
                    key, encodeURIComponent(variables[key]),
                );
            }
            return pathTemplate;
        };

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on("input", function (msg) {
            if (! node.server || ! node.server.matrixClient) {
                node.warn("No matrix server selected");
                return;
            }

            if(!node.server.isConnected()) {
                node.error("Matrix server connection is currently closed");
                node.send([null, msg]);
            }

            msg.topic = node.roomId || msg.topic;
            if(!msg.topic) {
                node.error("room must be defined in either msg.topic or in node config");
                return;
            }

            if(!msg.userId) {
                node.error("msg.userId is required to set user into a room");
                return;
            }

            // we need the status code, so set onlydata to false for this request
            node.server.matrixClient.http
                .authedRequest(
                    undefined,
                    'POST',
                    node.encodeUri(
                        "/_synapse/admin/v1/join/$room_id_or_alias",
                        { $room_id_or_alias: msg.topic },
                    ),
                    undefined,
                    { "user_id": msg.userId },
                    { prefix: '' }
                ).then(function(e){
                    msg.topic = e.room_id;
                    node.send([msg, null]);
                }).catch(function(e){
                    node.warn("Error joining user to room " + e);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });
    }
    RED.nodes.registerType("matrix-synapse-join-room", MatrixJoinRoom);
}