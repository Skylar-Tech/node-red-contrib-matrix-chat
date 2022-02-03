module.exports = function(RED) {
    const verificationRequests = new Map();

    function MatrixSecretStorage(n) {
        RED.nodes.createNode(this, n);

        var node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }

        node.status({ fill: "red", shape: "ring", text: "disconnected" });

        node.server.on("disconnected", function(){
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });

        node.server.on("connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        node.on('input', async function(msg){
            try {
                msg.hasSecretStorage = await node.server.matrixClient.hasSecretStorageKey();
            } catch(e) {
                console.log("ERROR", e);
            }

            if(msg.action) {
                if(msg.action === 'create') {
                    if(msg.hasSecretStorage && !msg.forceReset) {
                        node.error("Secret storage already setup. Pass msg.forceReset to bypass and regenerate.");
                        return;
                    }


                    // copying this from https://github.com/matrix-org/matrix-react-sdk/blob/e78a1adb6f1af2ea425b0bae9034fb7344a4b2e8/src/SecurityManager.ts#L294
                    const recoveryKey = await node.server.matrixClient.createRecoveryKeyFromPassphrase(msg.key || undefined);
                    if(msg.forceReset) {
                        await node.server.matrixClient.bootstrapSecretStorage({
                            createSecretStorageKey: async () => recoveryKey,
                            setupNewKeyBackup: true,
                            setupNewSecretStorage: true,
                        });
                    } else {
                        // For password authentication users after 2020-09, this cross-signing
                        // step will be a no-op since it is now setup during registration or login
                        // when needed. We should keep this here to cover other cases such as:
                        //   * Users with existing sessions prior to 2020-09 changes
                        //   * SSO authentication users which require interactive auth to upload
                        //     keys (and also happen to skip all post-authentication flows at the
                        //     moment via token login)
                        await node.server.matrixClient.bootstrapCrossSigning({
                            // maybe we can skip this?
                            // authUploadDeviceSigningKeys: this._doBootstrapUIAuth,
                        });
                        const backupInfo = await node.server.matrixClient.getKeyBackupVersion();
                        await node.server.matrixClient.bootstrapSecretStorage({
                            createSecretStorageKey: async () => this._recoveryKey,
                            keyBackupInfo: backupInfo,
                            setupNewKeyBackup: !backupInfo,
                            getKeyBackupPassphrase: () => {
                                // We may already have the backup key if we earlier went
                                // through the restore backup path, so pass it along
                                // rather than prompting again.
                                if (this._backupKey) {
                                    return this._backupKey;
                                }
                                return promptForBackupPassphrase();
                            },
                        });
                    }
                }

                if(msg.action === 'download') {
                    if(!msg.hasSecretStorage) {
                        node.error("Secret storage not setup so cannot download.");
                        return;
                    }
                }
            }

            node.send(msg);
        });
    }
    RED.nodes.registerType("matrix-secret-storage", MatrixSecretStorage);
}