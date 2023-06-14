module.exports = function(RED) {
    function MatrixWhoIsUser(n) {
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
                node.error("Matrix server connection is currently closed", msg);
                node.send([null, msg]);
            }

            if(!msg.userId) {
                node.error("msg.userId must be set to get user whois data", msg);
                return;
            }

            // we need the status code, so set onlydata to false for this request
            node.server.matrixClient.http
                .authedRequest(
                    'GET',
                    node.encodeUri(
                        "/_matrix/client/r0/admin/whois/$userId",
                        { $userId: msg.userId.toLowerCase() },
                    ),
                    undefined,
                    msg.payload,
                    { prefix: '' }
                ).then(function(e){
                    msg.payload = e;
                    node.send([msg, null]);
                }).catch(function(e){
                    node.warn("Error fetching user whois information " + e);
                    msg.error = e;
                    node.send([null, msg]);
                });
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-whois-user", MatrixWhoIsUser);
}