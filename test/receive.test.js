const assert = require("assert");
const path = require("path");
const { helper, SRC } = require("./helpers/run-node.js");
const fakeServer = require("./helpers/fake-server.js");
const receive = require(path.join(SRC, "matrix-receive.js"));

const MESSAGES_ON = {
    acceptText: true, acceptEmotes: true, acceptNotices: true, acceptStickers: true, acceptReactions: true,
    acceptFiles: true, acceptAudio: true, acceptImages: true, acceptVideos: true, acceptLocations: true,
};

// A MatrixEvent stand-in with what Receive reads.
function fakeEvent({ type, content = {}, prevContent = {}, sender = "@alice:x", stateKey, redacts }) {
    return {
        getType: () => type,
        getContent: () => content,
        getPrevContent: () => prevContent,
        getSender: () => sender,
        getStateKey: () => stateKey,
        isState: () => stateKey !== undefined,
        getId: () => "$ev",
        event: { type, content, sender, state_key: stateKey, redacts },
    };
}

// The msg the config node builds for every timeline event.
function sharedMsg(event) {
    const content = event.getContent();
    return {
        encrypted: event.getType() === "m.room.encrypted", redacted: false, content,
        type: content.msgtype || event.getType(), payload: content.body || content,
        isDM: false, isThread: false, mentions: null, userId: event.getSender(),
        topic: "!r:x", eventId: event.getId(), event,
    };
}

// Load a Receive node with config, deliver the events and return what it sent.
async function deliver(config, events) {
    await helper.unload();
    global.__matrixClient = { getUserId: () => "@bot:x", mxcUrlToHttp: (u) => u };
    const flow = [
        { id: "s", type: "matrix-server-config" },
        { id: "n", type: "matrix-receive", server: "s", ...config, wires: [["out"]] },
        { id: "out", type: "helper" },
    ];
    return new Promise((resolve) => {
        helper.load([fakeServer, receive], flow, () => {
            const sent = [];
            helper.getNode("out").on("input", (m) => sent.push(m));
            const server = helper.getNode("s");
            for (const e of events) {
                const event = fakeEvent(e);
                server.emit("Room.timeline", event, { roomId: "!r:x", name: "r" }, false, false, { liveEvent: true }, sharedMsg(event));
            }
            setTimeout(() => resolve(sent), 100);
        });
    });
}

const member = (membership, prev, sender, target, extra = {}) => ({
    type: "m.room.member", sender, stateKey: target,
    content: { membership, ...extra }, prevContent: prev ? { membership: prev } : {},
});

describe("Receive: room events", function() {
    this.timeout(10000);
    after(() => helper.unload());

    it("an old node only outputs messages", async () => {
        const sent = await deliver(MESSAGES_ON, [
            member("join", null, "@alice:x", "@alice:x"),
            { type: "m.room.topic", stateKey: "", content: { topic: "t" } },
            { type: "m.room.redaction", content: { redacts: "$x" } },
            { type: "com.example.custom", content: { a: 1 } },
            { type: "m.room.message", content: { msgtype: "m.text", body: "hello" } },
        ]);
        assert.deepStrictEqual(sent.map((m) => m.payload), ["hello"]);
    });

    it("describes every membership change", async () => {
        const cases = [
            [member("join", null, "@a:x", "@a:x"), "join"],
            [member("join", "join", "@a:x", "@a:x", { displayname: "A" }), "profile_change"],
            [member("invite", null, "@mod:x", "@a:x"), "invite"],
            [member("knock", null, "@a:x", "@a:x", { reason: "let me in" }), "knock"],
            [member("ban", "join", "@mod:x", "@a:x", { reason: "spam" }), "ban"],
            [member("leave", "ban", "@mod:x", "@a:x"), "unban"],
            [member("leave", "invite", "@a:x", "@a:x"), "invite_rejected"],
            [member("leave", "invite", "@mod:x", "@a:x"), "invite_revoked"],
            [member("leave", "knock", "@a:x", "@a:x"), "knock_retracted"],
            [member("leave", "knock", "@mod:x", "@a:x"), "knock_rejected"],
            [member("leave", "join", "@a:x", "@a:x"), "leave"],
            [member("leave", "join", "@mod:x", "@a:x"), "kick"],
        ];
        const sent = await deliver({ ...MESSAGES_ON, acceptMembership: true }, cases.map((c) => c[0]));
        assert.deepStrictEqual(sent.map((m) => m.membershipChange), cases.map((c) => c[1]));
        assert.deepStrictEqual(sent.map((m) => m.payload), cases.map((c) => c[1]));

        const ban = sent[4];
        assert.strictEqual(ban.type, "m.room.member");
        assert.strictEqual(ban.membership, "ban");
        assert.strictEqual(ban.prevMembership, "join");
        assert.strictEqual(ban.targetUserId, "@a:x");
        assert.strictEqual(ban.userId, "@mod:x");
        assert.strictEqual(ban.reason, "spam");
        assert.strictEqual(sent[1].displayName, "A");
    });

    it("outputs redactions with the deleted event ID, in both room versions", async () => {
        const sent = await deliver({ ...MESSAGES_ON, acceptRedactions: true }, [
            { type: "m.room.redaction", content: { redacts: "$v11", reason: "oops" } },
            { type: "m.room.redaction", content: {}, redacts: "$old" },
        ]);
        assert.deepStrictEqual(sent.map((m) => [m.type, m.redacts, m.payload]), [
            ["m.room.redaction", "$v11", "$v11"],
            ["m.room.redaction", "$old", "$old"],
        ]);
        assert.strictEqual(sent[0].reason, "oops");
    });

    it("outputs other state changes with the previous content", async () => {
        const sent = await deliver({ ...MESSAGES_ON, acceptState: true }, [
            { type: "m.room.topic", stateKey: "", content: { topic: "new" }, prevContent: { topic: "old" } },
        ]);
        assert.strictEqual(sent[0].type, "m.room.topic");
        assert.deepStrictEqual(sent[0].payload, { topic: "new" });
        assert.deepStrictEqual(sent[0].prevContent, { topic: "old" });
        assert.strictEqual(sent[0].stateKey, "");
    });

    it("outputs other events, limited to the listed types", async () => {
        const events = [
            { type: "com.example.ping", content: { n: 1 } },
            { type: "com.example.other", content: { n: 2 } },
            { type: "m.room.encrypted", content: { algorithm: "m.megolm.v1.aes-sha2" } },
        ];
        let sent = await deliver({ ...MESSAGES_ON, acceptOther: true }, events);
        assert.deepStrictEqual(sent.map((m) => m.eventType), ["com.example.ping", "com.example.other"]);
        sent = await deliver({ ...MESSAGES_ON, acceptOther: true, otherEventTypes: "com.example.ping" }, events);
        assert.deepStrictEqual(sent.map((m) => m.eventType), ["com.example.ping"]);
    });

    it("ignores the bot's own events", async () => {
        const sent = await deliver({ ...MESSAGES_ON, acceptMembership: true }, [member("join", null, "@bot:x", "@bot:x")]);
        assert.strictEqual(sent.length, 0);
    });
});
