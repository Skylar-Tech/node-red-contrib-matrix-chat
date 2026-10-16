module.exports = function(RED) {
    function MatrixSynapseDeactivateUser(n) {
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

            if(!msg.userId || typeof msg.userId !== 'string') {
                node.error("msg.userId must be set to deactivate a user (ex: @user:server.com)", msg);
                msg.error = "msg.userId must be set to deactivate a user (ex: @user:server.com)";
                node.send([null, msg]);
                return;
            }

            const path = node.encodeUri(
                "/_synapse/admin/v1/deactivate/$userId",
                { $userId: msg.userId },
            );
            node.server.matrixClient.http
                .authedRequest(
                    'POST',
                    path,
                    undefined,
                    // Synapse requires a JSON boolean (a string is rejected with 400)
                    {"erase": (msg.erase === true || msg.erase === 'true')},
                    {"prefix": '' })
                .then(function(e){
                    msg.payload = e;
                    node.send([msg, null]);
                }).catch(function(e){
                    node.error("Error deactivating user " + e, msg);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-synapse-deactivate-user", MatrixSynapseDeactivateUser);
}