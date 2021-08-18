module.exports = function(RED) {
    const got = require("got");
    const utf8 = require('utf8');
    const crypto = require('crypto');

    function MatrixSynapseRegister(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = this.credentials.server;
        this.sharedSecret = this.credentials.sharedSecret;

        if(!this.server) {
            node.error('Server URL must be configured on the node.');
            return;
        }

        if(!this.sharedSecret) {
            node.error('Shared registration secret must be configured on the node.');
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on("input", function (msg) {

            if(!msg.payload.username) {
                node.error("msg.payload.username is required");
                return;
            }

            if(!msg.payload.password) {
                node.error("msg.payload.password is required");
                return;
            }

            (async () => {
                try {
                    var response = await got.get(this.server + '/_synapse/admin/v1/register', {
                        responseType: 'json'
                    });
                } catch (error) {
                    msg.error = error;
                    msg.error_extra = 'Failed fetching nonce key from registration endpoint';
                    delete msg.payload.password;
                    node.status({fill:"red",shape:"ring",text:"Failure"});
                    node.send([null, msg]);
                    return;
                }

                var nonce = response.body.nonce;
                if(!nonce) {
                    node.error('Could not get nonce from /_synapse/admin/v1/register');
                    return;
                }

                let hmac = crypto.createHmac("sha1", node.sharedSecret )
                    .update(utf8.encode(nonce))
                    .update("\x00")
                    .update(utf8.encode(msg.payload.username))
                    .update("\x00")
                    .update(utf8.encode(msg.payload.password))
                    .update("\x00")
                    .update(msg.payload.admin ? "admin" : "notadmin")
                    .digest('hex');

                try {
                    response = await got.post(this.server + '/_synapse/admin/v1/register', {
                        json: {
                            "nonce": nonce,
                            "username": msg.payload.username,
                            "password": msg.payload.password,
                            "mac": hmac,
                            "admin": msg.payload.admin || false,
                            "user_type": msg.payload.user_type || null,
                        },
                        responseType: 'json'
                    });
                } catch (error) {
                    msg.error = error;
                    msg.error_extra = 'Failed submitting registration request';
                    delete msg.payload.password;
                    node.status({fill:"red",shape:"ring",text:"Failure"});
                    node.send([null, msg]);
                    return;
                }

                node.status({fill:"green",shape:"dot",text:"Registered: " + msg.payload.username});
                msg.payload = response.body;
                node.send(msg);
            })();
        });
    }
    RED.nodes.registerType("matrix-synapse-register", MatrixSynapseRegister, {
        credentials: {
            server: { type:"text", value: null, required: true },
            sharedSecret: { type:"text", value: null },
        }
    });
}