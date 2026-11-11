const path = require("path");
const helper = require("node-red-node-test-helper");
const fakeServer = require("./fake-server.js");

helper.init(require.resolve("node-red"));

const SRC = path.join(__dirname, "..", "..", "src");

/**
 * Load one node with the given config, wired to an output helper and an error
 * helper, send it msg and resolve with { ok, err, errors } once it answers
 * (or after the timeout). errors holds what the node passed to node.error.
 *
 * @param {string} type node type, also the file name in src/
 * @param {object} config node config
 * @param {object} msg input message
 * @param {object} [client] the matrix client; defaults to global.__matrixClient
 */
async function runNode(type, config, msg, client, timeout = 15000) {
    await helper.unload();
    if (client) global.__matrixClient = client;
    const flow = [
        { id: "s", type: "matrix-server-config" },
        { id: "n", type, server: "s", ...config, wires: [["ok"], ["err"]] },
        { id: "ok", type: "helper" },
        { id: "err", type: "helper" },
    ];
    return new Promise((resolve) => {
        helper.load([fakeServer, require(path.join(SRC, type + ".js"))], flow, () => {
            const result = { errors: [] };
            const node = helper.getNode("n");
            const error = node.error.bind(node);
            node.error = (text, m) => { result.errors.push(String(text)); error(text, m); };
            const finish = () => { clearTimeout(timer); resolve(result); };
            const timer = setTimeout(() => { result.timeout = true; resolve(result); }, timeout);
            helper.getNode("ok").on("input", (m) => { result.ok = m; finish(); });
            helper.getNode("err").on("input", (m) => { result.err = m; finish(); });
            node.receive(msg);
        });
    });
}

module.exports = { helper, runNode, SRC };
