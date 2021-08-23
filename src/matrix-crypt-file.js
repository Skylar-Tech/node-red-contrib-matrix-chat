module.exports = function(RED) {
    const got = require('got');
    const crypto = require('isomorphic-webcrypto');

    function MatrixDecryptFile(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;

        node.on("input", async function (msg) {
            if(!msg.type) {
                node.error('msg.type is required.');
                return;
            }

            if(!msg.content) {
                node.error('msg.content is required.');
                return;
            }

            if(!msg.content.file) {
                node.error('msg.content.file is required.');
                return;
            }

            if(!msg.url) {
                node.error('msg.url is required.');
                return;
            }

            try{
                let buffer = await got(msg.url).buffer();
                msg.payload = Buffer.from(await decryptAttachment(buffer, msg.content.file));

                // handle thumbnail decryption if necessary
                if(
                    msg.type.toLowerCase() === 'm.image'
                    && msg.thumbnail_url
                    && msg.content.info.thumbnail_file
                ) {
                    let thumb_buffer = await got(msg.thumbnail_url).buffer();
                    msg.thumbnail_payload = Buffer.from(await decryptAttachment(thumb_buffer, msg.content.info.thumbnail_file));
                }
            } catch(error){
                node.error(error);
                msg.error = error;
                node.send([null, msg]);
            }

            msg.filename = msg.content.filename || msg.content.body;

            node.send([msg, null]);
        });
    }
    RED.nodes.registerType("matrix-decrypt-file", MatrixDecryptFile);

    function atob(a) {
        return new Buffer.from(a, 'base64').toString('binary');
    }

    function btoa(b) {
        return new Buffer.from(b).toString('base64');
    }

    // the following was taken & modified from https://github.com/matrix-org/browser-encrypt-attachment/blob/master/index.js
    /**
     * Encrypt an attachment.
     * @param {ArrayBuffer} plaintextBuffer The attachment data buffer.
     * @return {Promise} A promise that resolves with an object when the attachment is encrypted.
     *      The object has a "data" key with an ArrayBuffer of encrypted data and an "info" key
     *      with an object containing the info needed to decrypt the data.
     */
    function encryptAttachment(plaintextBuffer) {
        let cryptoKey; // The AES key object.
        let exportedKey; // The AES key exported as JWK.
        let ciphertextBuffer; // ArrayBuffer of encrypted data.
        let sha256Buffer; // ArrayBuffer of digest.
        let ivArray; // Uint8Array of AES IV
        // Generate an IV where the first 8 bytes are random and the high 8 bytes
        // are zero. We set the counter low bits to 0 since it makes it unlikely
        // that the 64 bit counter will overflow.
        ivArray = new Uint8Array(16);
        crypto.getRandomValues(ivArray.subarray(0,8));
        // Load the encryption key.
        return crypto.subtle.generateKey(
            {"name": "AES-CTR", length: 256}, true, ["encrypt", "decrypt"]
        ).then(function(generateKeyResult) {
            cryptoKey = generateKeyResult;
            // Export the Key as JWK.
            return crypto.subtle.exportKey("jwk", cryptoKey);
        }).then(function(exportKeyResult) {
            exportedKey = exportKeyResult;
            // Encrypt the input ArrayBuffer.
            // Use half of the iv as the counter by setting the "length" to 64.
            return crypto.subtle.encrypt(
                {name: "AES-CTR", counter: ivArray, length: 64}, cryptoKey, plaintextBuffer
            );
        }).then(function(encryptResult) {
            ciphertextBuffer = encryptResult;
            // SHA-256 the encrypted data.
            return crypto.subtle.digest("SHA-256", ciphertextBuffer);
        }).then(function (digestResult) {
            sha256Buffer = digestResult;

            return {
                data: ciphertextBuffer,
                info: {
                    v: "v2",
                    key: exportedKey,
                    iv: encodeBase64(ivArray),
                    hashes: {
                        sha256: encodeBase64(new Uint8Array(sha256Buffer)),
                    },
                },
            };
        });
    }

    /**
     * Decrypt an attachment.
     * @param {ArrayBuffer} ciphertextBuffer The encrypted attachment data buffer.
     * @param {Object} info The information needed to decrypt the attachment.
     * @param {Object} info.key AES-CTR JWK key object.
     * @param {string} info.iv Base64 encoded 16 byte AES-CTR IV.
     * @param {string} info.hashes.sha256 Base64 encoded SHA-256 hash of the ciphertext.
     * @return {Promise} A promise that resolves with an ArrayBuffer when the attachment is decrypted.
     */
    function decryptAttachment(ciphertextBuffer, info) {

        if (info === undefined || info.key === undefined || info.iv === undefined
            || info.hashes === undefined || info.hashes.sha256 === undefined) {
            throw new Error("Invalid info. Missing info.key, info.iv or info.hashes.sha256 key");
        }

        let cryptoKey; // The AES key object.
        let ivArray = decodeBase64(info.iv);
        let expectedSha256base64 = info.hashes.sha256;
        // Load the AES from the "key" key of the info object.
        return crypto.subtle.importKey(
            "jwk", info.key, {"name": "AES-CTR"}, false, ["encrypt", "decrypt"]
        ).then(function (importKeyResult) {
            cryptoKey = importKeyResult;
            // Check the sha256 hash
            return crypto.subtle.digest("SHA-256", ciphertextBuffer);
        }).then(function (digestResult) {
            if (encodeBase64(new Uint8Array(digestResult)) !== expectedSha256base64) {
                throw new Error("Mismatched SHA-256 digest (expected: " + encodeBase64(new Uint8Array(digestResult)) + ") got (" + expectedSha256base64 + ")");
            }
            let counterLength;
            if (info.v.toLowerCase() === "v1" || info.v.toLowerCase() === "v2") {
                // Version 1 and 2 use a 64 bit counter.
                counterLength = 64;
            } else {
                // Version 0 uses a 128 bit counter.
                counterLength = 128;
            }
            return crypto.subtle.decrypt(
                {name: "AES-CTR", counter: ivArray, length: counterLength}, cryptoKey, ciphertextBuffer
            );
        });
    }

    /**
     * Encode a typed array of uint8 as base64.
     * @param {Uint8Array} uint8Array The data to encode.
     * @return {string} The base64 without padding.
     */
    function encodeBase64(uint8Array) {
        // Misinterpt the Uint8Array as Latin-1.
        // window.btoa expects a unicode string with codepoints in the range 0-255.
        // var latin1String = String.fromCharCode.apply(null, uint8Array);
        // Use the builtin base64 encoder.
        var paddedBase64 = btoa(uint8Array);
        // Calculate the unpadded length.
        var inputLength = uint8Array.length;
        var outputLength = 4 * Math.floor((inputLength + 2) / 3) + (inputLength + 2) % 3 - 2;
        // Return the unpadded base64.
        return paddedBase64.slice(0, outputLength);
    }

    /**
     * Decode a base64 string to a typed array of uint8.
     * This will decode unpadded base64, but will also accept base64 with padding.
     * @param {string} base64 The unpadded base64 to decode.
     * @return {Uint8Array} The decoded data.
     */
    function decodeBase64(base64) {
        // Pad the base64 up to the next multiple of 4.
        var paddedBase64 = base64 + "===".slice(0, (4 - base64.length % 4) % 4);
        // Decode the base64 as a misinterpreted Latin-1 string.
        // window.atob returns a unicode string with codepoints in the range 0-255.
        var latin1String = atob(paddedBase64);
        // Encode the string as a Uint8Array as Latin-1.
        var uint8Array = new Uint8Array(latin1String.length);
        for (var i = 0; i < latin1String.length; i++) {
            uint8Array[i] = latin1String.charCodeAt(i);
        }
        return uint8Array;
    }
}