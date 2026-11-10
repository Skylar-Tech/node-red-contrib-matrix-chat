/**
 * OAuth 2.0 login (Matrix 1.15 "next-generation auth", for homeservers that
 * delegate login to an authorization server such as Matrix Authentication
 * Service) using the device authorization grant (RFC 8628, Matrix 1.18):
 * Node-RED shows a code, the user approves it in a browser, and we get an
 * access token plus a refresh token.
 *
 * https://spec.matrix.org/latest/client-server-api/#oauth-20-api
 */
const crypto = require("crypto");

const CLIENT_URI = "https://github.com/Skylar-Tech/node-red-contrib-matrix-chat";
const STORAGE_KEY = "oauth_tokens";
const SESSION_TTL_MS = 30 * 60 * 1000;

function fingerprint(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * The tokens to start the client with.
 *
 * Access tokens from an authorization server expire after a few minutes and
 * every refresh replaces the refresh token, so the configured tokens stop
 * working after the first refresh. Refreshed tokens are saved in the
 * account's storage folder; they are used while the configured refresh token
 * is the one they were refreshed from (a new login replaces them).
 */
function loadTokens(localStorage, credentials) {
    const tokens = {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken || undefined,
    };
    if (!credentials.refreshToken || !credentials.oauthClientId) {
        return tokens;
    }
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (saved && saved.base === fingerprint(credentials.refreshToken) && saved.accessToken && saved.refreshToken) {
            tokens.accessToken = saved.accessToken;
            tokens.refreshToken = saved.refreshToken;
            tokens.restored = true;
        }
    } catch (e) {
        // unreadable: start from the configured tokens
    }
    return tokens;
}

/**
 * Remember refreshed tokens (the SDK's onTokenRefresh callback).
 */
function saveTokens(localStorage, credentials, newTokens, previousRefreshToken) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        base: fingerprint(credentials.refreshToken),
        accessToken: newTokens.accessToken,
        // the server may keep the same refresh token
        refreshToken: newTokens.refreshToken || previousRefreshToken,
    }));
}

/**
 * Pending device logins started from the editor, by id.
 */
const sessions = new Map();

function pruneSessions() {
    const now = Date.now();
    for (const [id, s] of sessions) {
        if (now - s.created > SESSION_TTL_MS) {
            sessions.delete(id);
        }
    }
}

/**
 * Start a device login: discover the homeserver's authorization server,
 * register this Node-RED as an OAuth client and request a user code.
 *
 * @returns {Promise<object>} what the editor shows: the code and where to enter it
 */
async function startDeviceLogin(sdk, baseUrl, clientName) {
    pruneSessions();
    const client = sdk.createClient({ baseUrl: baseUrl });
    let metadata;
    try {
        metadata = await client.getAuthMetadata();
    } catch (e) {
        const err = new Error("This homeserver does not support OAuth login. Use the password or an access token instead.");
        err.cause = e;
        throw err;
    }
    if (!metadata.device_authorization_endpoint) {
        throw new Error("This homeserver's login service does not support logging in with a code (device authorization).");
    }
    const clientId = await sdk.OAuth2.registerClient(metadata, {
        client_name: clientName || "Node-RED",
        client_uri: CLIENT_URI,
        application_type: "native",
        response_types: [],
        grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    });
    const oauth = new sdk.OAuth2(metadata, { clientId: clientId });
    const grant = await oauth.startDeviceAuthorizationGrant();

    const id = crypto.randomBytes(16).toString("hex");
    const session = {
        created: Date.now(),
        status: "pending",
        result: null,
        error: null,
    };
    sessions.set(id, session);

    // Poll the token endpoint in the background; the editor asks for the result.
    oauth.waitForDeviceAuthorizationGrant(grant).then(async function(response) {
        if (!response.access_token) {
            session.status = "error";
            session.error = response.error === "access_denied"
                ? "The login was cancelled in the browser."
                : "The code expired before it was approved. Start again.";
            return;
        }
        const authed = sdk.createClient({ baseUrl: baseUrl, accessToken: response.access_token });
        const whoami = await authed.whoami();
        session.status = "done";
        session.result = {
            accessToken: response.access_token,
            refreshToken: response.refresh_token || "",
            oauthClientId: clientId,
            userId: whoami.user_id,
            deviceId: whoami.device_id || oauth.context.deviceId,
        };
    }).catch(function(e) {
        session.status = "error";
        session.error = (e && e.message) || String(e);
    });

    return {
        id: id,
        userCode: grant.user_code,
        verificationUri: grant.verification_uri,
        verificationUriComplete: grant.verification_uri_complete || null,
        expiresIn: grant.expires_in,
    };
}

/**
 * The state of a device login started with startDeviceLogin. A finished
 * login is handed out once.
 */
function pollDeviceLogin(id) {
    pruneSessions();
    const session = sessions.get(id);
    if (!session) {
        return { status: "error", error: "This login has expired. Start again." };
    }
    if (session.status !== "pending") {
        sessions.delete(id);
    }
    return { status: session.status, error: session.error, result: session.result };
}

module.exports = {
    loadTokens,
    saveTokens,
    startDeviceLogin,
    pollDeviceLogin,
};
