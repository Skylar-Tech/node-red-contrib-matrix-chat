module.exports = function(RED) {
    function MatrixCreateRoom(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);

        if(!this.server) {
            node.error('Server must be configured on the node.', {});
            return;
        }
        node.server.register(node);

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
                node.error("Matrix server connection is currently closed", {});
                node.send([null, msg]);
            }

            if(!msg.payload) {
                msg.payload = {};
            } else if(typeof msg.payload === 'string') {
                msg.payload = {
                    name: msg.payload
                };
            }

            node.server.matrixClient
                .createRoom(msg.payload || {})
                .then(function(e){
                    msg.topic = e.room_id;
                    node.send([msg, null]);
                }).catch(function(e){
                    node.warn("Error creating room " + e);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-create-room", MatrixCreateRoom);
}