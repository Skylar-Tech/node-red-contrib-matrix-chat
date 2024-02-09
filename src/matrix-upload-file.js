const crypto = require("isomorphic-webcrypto");
const ffmpeg = require('fluent-ffmpeg');
const getImageSize = require('image-size');
const tmp = require('tmp');
const fs = require('fs');
const path = require('path');
module.exports = function(RED) {
    function MatrixUploadFile(n) {
        RED.nodes.createNode(this, n);

        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.inputType = n.inputType;
        this.inputValue = n.inputValue;
        this.fileNameType = n.fileNameType;
        this.fileNameValue = n.fileNameValue;
        this.contentType = n.contentType;
        this.generateThumbnails = n.generateThumbnails;

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

        async function detectFileType(filename, bufferOrPath)
        {
            const Mime = require('mime');
            let file = Buffer.isBuffer(bufferOrPath) ? filename : bufferOrPath;

            if(file)
            {
                let type = Mime.getType(file);
                let ext = Mime.getExtension(file);
                if(type) {
                    return {ext: ext, mime: type}
                }
            }
        }

        function getFileBuffer(data)
        {
            if(Buffer.isBuffer(data)) {
                return data;
            }

            if (data && RED.settings.fileWorkingDirectory && !path.isAbsolute(data)) {
                return fs.readFileSync(path.resolve(path.join(RED.settings.fileWorkingDirectory,data)));
            }
            return fs.readFileSync(data);
        }

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

        node.on("input", onInput);
        async function onInput(msg)
        {
            if (! node.server || ! node.server.matrixClient) {
                node.warn("No matrix server selected");
                return;
            }

            if(!node.server.isConnected()) {
                node.error("Matrix server connection is currently closed", msg);
                msg.error = "Matrix server connection is currently closed";
                node.send([null, msg]);
                return;
            }

            let bufferOrPath = getToValue(msg, node.inputType, node.inputValue);
            if(!bufferOrPath) {
                node.error('Missing file path/buffer input', msg);
                msg.error = 'Missing file path/buffer input';
                node.send([null, msg]);
                return;
            }

            let filename = getToValue(msg, node.fileNameType, node.fileNameValue);
            if(!filename || typeof filename !== 'string') {
                if(!Buffer.isBuffer(bufferOrPath)) {
                    filename = path.basename(bufferOrPath);
                } else {
                    node.error('Missing filename, this is required if input is a file buffer', msg);
                    msg.error = 'Missing filename, this is required if input is a file buffer';
                    node.send([null, msg]);
                    return;
                }
            }

            msg.contentType = node.contentType || msg.contentType || null;
            let detectedFileType = await detectFileType(filename, bufferOrPath);
            node.log("Detected file type " + JSON.stringify(detectedFileType) + " for " + (Buffer.isBuffer(bufferOrPath) ? 'buffer' : `file ${bufferOrPath}`), msg);

            let contentType = msg.contentType || detectedFileType?.mime || null,
                msgtype = msg.msgtype || null;
            if(!contentType) {
                node.warn("Content-type failed to detect, falling back to text/plain", msg);
                contentType = 'text/plain';
            }
            if(!msgtype) {
                msgtype = autoDetectMatrixMessageType(detectedFileType);
            }

            let encryptedFile = null;
            if(msg.encrypted) {
                encryptedFile = await encryptAttachment(getFileBuffer(bufferOrPath));
            }

            node.log("Uploading file ", msg);
            let file;
            try {
                file = await node.server.matrixClient.uploadContent(
                    encryptedFile?.data || getFileBuffer(bufferOrPath),
                {
                        name: filename, // Name to give the file on the server.
                        rawResponse: false, // Return the raw body, rather than parsing the JSON.
                        type: contentType, // Content-type for the upload. Defaults to file.type, or applicaton/octet-stream.
                        onlyContentUri: false // Just return the content URI, rather than the whole body. Defaults to false. Ignored if opts.rawResponse is true.
                    });
            } catch(e) {
                node.error("Upload content error " + e);
                msg.error = e;
                node.send([null, msg]);
                return;
            }

            // we call this method when we need a file and cannot use the buffer
            // so if we get passed a buffer we write it to a tmp file and return that
            // otherwise we just return the string because it's already a file
            let tempFile = null;
            function getFile(bufferOrFile) {
                if(!Buffer.isBuffer(bufferOrFile)) {
                    return bufferOrFile; // already a file
                }

                if(tempFile) {
                    return tempFile;
                }

                // write buffer to tmp file and return path
                let tmpObj = tmp.fileSync({ postfix: `.${detectedFileType.ext}` });
                fs.writeFileSync(tmpObj.name, bufferOrFile);
                tempFile = tmpObj.name;
                return tmpObj.name;
            }

            function deleteTempFile() {
                if(!tempFile) return null;
                fs.rmSync(tempFile);
            }

            // get size of a buffer or file in bytes
            function getFileSize(bufferOrPath) {
                if(Buffer.isBuffer(bufferOrPath)) {
                    return Buffer.byteLength(bufferOrPath);
                }

                return fs.statSync(bufferOrPath).size;
            }

            async function addThumbnail(buffer) {
                let imageSize = getImageSize(Buffer.isBuffer(buffer) ? buffer : buffer.data);
                msg.payload.info.thumbnail_info = {
                    w: imageSize.width,
                    h: imageSize.height,
                    size: getFileSize(Buffer.isBuffer(buffer) ? buffer : buffer.data)
                }
                let uploadedThumbnail = await node.server.matrixClient.uploadContent(
                    Buffer.isBuffer(buffer) ? buffer : buffer.data,
                    {
                        name: "thumbnail.png", // Name to give the file on the server.
                        rawResponse: false, // Return the raw body, rather than parsing the JSON.
                        type: "image/png", // Content-type for the upload. Defaults to file.type, or applicaton/octet-stream.
                        onlyContentUri: false // Just return the content URI, rather than the whole body. Defaults to false. Ignored if opts.rawResponse is true.
                    });
                // delete local file
                if(msg.encrypted) {
                    msg.payload.info.thumbnail_file.url = uploadedThumbnail.content_uri;
                } else {
                    msg.payload.info.thumbnail_url = uploadedThumbnail.content_uri;
                }
            }

            function _ffmpegVideoThumbnail(filepath){
                return new Promise((resolve,reject) => {
                    let filename = `${msg._msgid}-screenshot.png`;
                    ffmpeg(filepath)
                        .on('end', async function() {
                            let path = `/tmp/${filename}`;
                            let buffer = getFileBuffer(path);
                            let encryptedThumbnail = null;
                            if(msg.encrypted) {
                                encryptedThumbnail = await encryptAttachment(buffer);
                                msg.payload.info.thumbnail_file = encryptedFile.info;
                            }
                            try {
                                await addThumbnail(encryptedThumbnail || buffer);
                                fs.rmSync(path); // delete temporary thumbnail file
                                resolve();
                            } catch(e) {
                                return reject(new Error("Thumbnail upload failure: " + e));
                            }
                        })
                        .on('error', function(err) {
                            return reject(err);
                        })
                        .screenshots({
                            timestamps: [0],
                            filename: filename,
                            folder: '/tmp',
                            size: '320x?'
                        });
                });
            }

            msg.payload = {};
            if(msg.encrypted) {
                msg.payload.file = encryptedFile?.info || {};
                msg.payload.file.url = file.content_uri;
            } else {
                msg.payload.url = file.content_uri;
            }
            msg.payload.msgtype = msgtype;
            msg.payload.body = msg.body || msg.filename || "";
            msg.payload.info = {
                "mimetype": contentType,
                "size": getFileSize(bufferOrPath),
            };
            if(msgtype === 'm.image') {
                // detect size of image
                try {
                    let imageSize = getImageSize(buffer);
                    msg.payload.info.h = imageSize.height;
                    msg.payload.info.w = imageSize.width;
                } catch(e) {
                    node.error("Failed to get image size: " + e, msg);
                }
            } else if(msgtype === 'm.audio' && detectedFileType) {
                try {
                    // detect duration of audio clip
                    let filepath = getFile(bufferOrPath);
                    let metadata = await _ffprobe(filepath);
                    let audioStream = metadata?.streams.filter(function(stream){return stream.codec_type === "audio" || false;})[0];
                    if(audioStream?.duration) {
                        msg.payload.info.duration = audioStream?.duration * 1000;
                    }
                } catch(e) {
                    node.error(e, msg);
                }
                deleteTempFile();
            } else if(msgtype === 'm.video' && detectedFileType) {
                let filepath = getFile(bufferOrPath);

                try {
                    // detect duration & width/height of video clip
                    let metadata = await _ffprobe(filepath);
                    let videoStream = metadata?.streams.filter(function(stream){return stream.codec_type === "video" || false;})[0];
                    if(videoStream) {
                        msg.payload.info.duration = videoStream.duration * 1000;
                        msg.payload.info.w = videoStream.width;
                        msg.payload.info.h = videoStream.height;
                    }
                } catch(e) {
                    node.error("ffprobe error: " + e);
                }

                if(node.generateThumbnails) {
                    try {
                        await _ffmpegVideoThumbnail(filepath);
                    } catch(e) {
                        node.error("Screenshot generation error: " + e);
                    }
                }
                deleteTempFile();
            }

            node.send(msg, null);
        }

        node.on("close", function() {
            node.server.deregister(node);
        });
    }
    RED.nodes.registerType("matrix-upload-file", MatrixUploadFile);

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

    function autoDetectMatrixMessageType(fileType) {
        switch(fileType ? fileType.mime.split('/')[0].toLowerCase() : undefined) {
            case 'video': return 'm.video';
            case 'image': return 'm.image';
            case 'audio': return 'm.audio';
            default: return 'm.file';
        }
    }

    // ffprobe method for getting metadata from a file wrapped in a promise
    function _ffprobe(filepath){
        return new Promise((resolve,reject) => {
            ffmpeg.ffprobe(filepath, function(err, metadata) {
                if(err) {
                    return reject(new Error(err));
                }

                resolve(metadata);
            });
        });
    }
}