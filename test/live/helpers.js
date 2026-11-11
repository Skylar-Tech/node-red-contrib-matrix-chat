// Shared setup for the live tests, which run the nodes against a real
// homeserver. Start one with test/live/start-synapse.sh, then run
// `npm run test:live`. MATRIX_TEST_HS and MATRIX_TEST_PASSWORD point the
// tests somewhere else; the server needs the users the script creates.
const path = require("path");
const { helper, runNode: runWith } = require("../helpers/run-node.js");

const HS = process.env.MATRIX_TEST_HS || "http://127.0.0.1:18008";
const PASSWORD = process.env.MATRIX_TEST_PASSWORD || "pass1234";
const SERVER_NAME = process.env.MATRIX_TEST_SERVER_NAME || "localhost";
const enc = encodeURIComponent;
const uid = (name) => `@${name}:${SERVER_NAME}`;

async function api(token, method, urlPath, body) {
    const r = await fetch(HS + urlPath, {
        method,
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { json = text; }
    return { status: r.status, json };
}

let sdk;
let checked = false;

// Log in as a test user and return a matrix-js-sdk client (not syncing).
async function realClient(user) {
    if (!checked) {
        try {
            await fetch(HS + "/_matrix/client/versions");
        } catch (e) {
            throw new Error(`No homeserver at ${HS}. Start one with test/live/start-synapse.sh`);
        }
        checked = true;
    }
    sdk = sdk || await import("matrix-js-sdk");
    require("loglevel").getLogger("matrix").setLevel("error");
    const r = await fetch(HS + "/_matrix/client/v3/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "m.login.password", identifier: { type: "m.id.user", user }, password: PASSWORD }),
    });
    const login = await r.json();
    if (!login.access_token) throw new Error(`Could not log in as ${user}: ${JSON.stringify(login)}`);
    return {
        client: sdk.createClient({ baseUrl: HS, userId: login.user_id, accessToken: login.access_token, deviceId: login.device_id }),
        token: login.access_token,
        userId: login.user_id,
    };
}

// Run a node with the bot's client (set global.__matrixClient first).
function runNode(type, config, msg) {
    return runWith(type, config, msg, undefined, 15000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { helper, HS, SERVER_NAME, api, enc, uid, realClient, runNode, sleep, path };
