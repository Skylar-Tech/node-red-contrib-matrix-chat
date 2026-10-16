module.exports = function(RED) {
    function MatrixSynapseUsers(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);

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

        node.on("input", function (msg) {
            if (! node.server || ! node.server.matrixClient) {
                msg.error = "No matrix server selected";
                node.error("No matrix server selected", msg);
                node.send([null, msg]);
                return;
            }

            if(!node.server.isConnected()) {
                msg.error = "Matrix server connection is currently closed";
                node.error("Matrix server connection is currently closed", msg);
                node.send([null, msg]);
                return;
            }

            let queryParams = {
                'from': msg.from || 0,
                'limit': msg.limit || 100
            };

            // msg.guests=false must be sent explicitly: Synapse defaults to
            // including guests, so only sending the parameter when truthy
            // made "false" impossible.
            if(msg.guests !== undefined && msg.guests !== null) {
                queryParams['guests'] = (msg.guests === true || msg.guests === 'true') ? 'true' : 'false';
            }

            if(msg.order_by) {
                queryParams['order_by'] = msg.order_by;
            }

            node.server.matrixClient.http
                .authedRequest(
                    'GET',
                    "/_synapse/admin/v2/users",
                    queryParams,
                    undefined,
                    { prefix: '' }
                ).then(function(e){
                    msg.payload = e;
                    node.send([msg, null]);
                }).catch(function(e){
                    node.error("Error fetching server user list " + e, msg);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-synapse-users", MatrixSynapseUsers);
}