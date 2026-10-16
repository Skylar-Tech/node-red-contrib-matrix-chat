module.exports = function(RED) {
    const crypto = require('crypto');

    function MatrixSynapseRegister(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = this.credentials.server;
        this.sharedSecret = this.credentials.sharedSecret;

        if(!this.server) {
            node.error('Server URL must be configured on the node.', {});
            return;
        }

        if(!this.sharedSecret) {
            node.error('Shared registration secret must be configured on the node.', {});
            return;
        }

        node.on("input", async function (msg) {
            const got = (await import('got')).default;

            const fail = function(text, error, extra) {
                // before node.error(): Catch nodes get a copy of msg as it is now
                if(msg.payload && typeof msg.payload === 'object') {
                    delete msg.payload.password;
                }
                // only the message: got's errors carry the request options,
                // which include the password
                msg.error = error ? String(error.message || error) : text;
                if(extra) {
                    msg.error_extra = extra;
                }
                node.error(text, msg);
                node.status({fill:"red",shape:"ring",text:"Failure"});
                node.send([null, msg]);
            };

            if(!msg.payload || typeof msg.payload !== 'object') {
                fail("msg.payload must be an object with username and password");
                return;
            }

            if(!msg.payload.username || typeof msg.payload.username !== 'string') {
                fail("msg.payload.username is required");
                return;
            }

            if(!msg.payload.password || typeof msg.payload.password !== 'string') {
                fail("msg.payload.password is required");
                return;
            }

            if(msg.payload.user_type && typeof msg.payload.user_type !== 'string') {
                fail("msg.payload.user_type must be a string");
                return;
            }

            // avoid "//_synapse/..." (Synapse answers 404) when the URL ends in "/"
            const registerUrl = String(node.server).replace(/\/+$/, '') + '/_synapse/admin/v1/register';

            let response;
            try {
                response = await got.get(registerUrl, {
                    responseType: 'json'
                });
            } catch (error) {
                fail("Failed fetching nonce key from registration endpoint: " + error, error, 'Failed fetching nonce key from registration endpoint');
                return;
            }

            let nonce = response.body && response.body.nonce;
            if(!nonce) {
                fail('Could not get nonce from /_synapse/admin/v1/register');
                return;
            }

            // Strings are hashed as UTF-8 (crypto's default for strings). They
            // used to be run through utf8.encode() first, which encoded every
            // non-ASCII character twice, so Synapse rejected the MAC
            // ("HMAC incorrect") for any non-ASCII username or password.
            let hmac = crypto.createHmac("sha1", node.sharedSecret)
                .update(nonce)
                .update("\x00")
                .update(msg.payload.username)
                .update("\x00")
                .update(msg.payload.password)
                .update("\x00")
                .update(msg.payload.admin ? "admin" : "notadmin");

            if(msg.payload.user_type) {
                hmac.update("\x00")
                    .update(msg.payload.user_type);
            }

            hmac = hmac.digest('hex');

            let body = {
                "nonce": nonce,
                "username": msg.payload.username,
                "password": msg.payload.password,
                "mac": hmac,
                "admin": msg.payload.admin || false,
                "user_type": msg.payload.user_type || null,
            };
            if(msg.payload.displayname) {
                // not part of the MAC
                body.displayname = String(msg.payload.displayname);
            }

            try {
                response = await got.post(registerUrl, {
                    json: body,
                    responseType: 'json'
                });
            } catch (error) {
                let detail = error && error.response && error.response.body && error.response.body.error;
                fail("Failed submitting registration request: " + (detail || error), error, 'Failed submitting registration request');
                return;
            }

            node.status({fill:"green",shape:"dot",text:"Registered: " + msg.payload.username});
            msg.payload = response.body;
            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-synapse-register", MatrixSynapseRegister, {
        credentials: {
            server: { type:"text", value: null, required: true },
            sharedSecret: { type:"password", value: null },
        }
    });
}