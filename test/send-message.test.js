const assert = require("assert");
const { helper, runNode } = require("./helpers/run-node.js");

const NEW_DEFAULTS = {
    replyToType: "msg", replyToValue: "replyTo", notifyReplySender: true,
    mentionUsersType: "msg", mentionUsersValue: "mentionUsers",
    mentionRoomType: "msg", mentionRoomValue: "mentionRoom",
};

async function send(config, msg) {
    const sent = [];
    const client = {
        getUserId: () => "@bot:x",
        getRoom: () => ({ findEventById: (id) => id === "$known" ? { getSender: () => "@carol:x" } : null }),
        fetchRoomEvent: async (room, id) => {
            if (id === "$remote") return { sender: "@dave:x" };
            throw new Error("404");
        },
        sendMessage: async (room, content) => { sent.push(content); return { event_id: "$new" }; },
    };
    const r = await runNode("matrix-send-message", { messageType: "m.text", messageFormat: "", threadReplyType: "msg", threadReplyValue: "isThread", ...config }, msg, client);
    return { sent, ...r };
}

describe("Send Message: replies and mentions", function() {
    this.timeout(10000);
    after(() => helper.unload());

    it("an old node (no reply or mention settings) ignores msg.mentions from Receive", async () => {
        const r = await send({}, { topic: "!r:x", payload: "hi", eventId: "$in", userId: "@alice:x", replyTo: true, mentions: { room: true } });
        assert.deepStrictEqual(r.sent[0], { msgtype: "m.text", body: "hi" });
    });

    it("sends plain content when nothing is set", async () => {
        const r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", eventId: "$in", userId: "@alice:x", mentions: { room: true } });
        assert.deepStrictEqual(r.sent[0], { msgtype: "m.text", body: "hi" });
    });

    it("msg.replyTo = true replies to msg.eventId and mentions its sender", async () => {
        const r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", eventId: "$in", userId: "@alice:x", replyTo: true });
        assert.deepStrictEqual(r.sent[0]["m.relates_to"], { "m.in_reply_to": { event_id: "$in" } });
        assert.deepStrictEqual(r.sent[0]["m.mentions"], { user_ids: ["@alice:x"] });
    });

    it("Reply To set to true on the node works, and notifying the sender can be turned off", async () => {
        const r = await send({ ...NEW_DEFAULTS, replyToType: "bool", replyToValue: "true", notifyReplySender: false },
            { topic: "!r:x", payload: "hi", eventId: "$in", userId: "@alice:x" });
        assert.deepStrictEqual(r.sent[0]["m.relates_to"], { "m.in_reply_to": { event_id: "$in" } });
        assert.strictEqual(r.sent[0]["m.mentions"], undefined);
    });

    it("finds the sender of an event ID locally, then on the server", async () => {
        let r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", replyTo: "$known" });
        assert.deepStrictEqual(r.sent[0]["m.mentions"], { user_ids: ["@carol:x"] });
        r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", replyTo: "$remote" });
        assert.deepStrictEqual(r.sent[0]["m.mentions"], { user_ids: ["@dave:x"] });
        r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", replyTo: "$missing" });
        assert.deepStrictEqual(r.sent[0]["m.relates_to"], { "m.in_reply_to": { event_id: "$missing" } });
        assert.strictEqual(r.sent[0]["m.mentions"], undefined);
    });

    it("does not mention the bot when replying to its own message", async () => {
        const r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", eventId: "$in", userId: "@bot:x", replyTo: true });
        assert.strictEqual(r.sent[0]["m.mentions"], undefined);
    });

    it("msg.mentionUsers takes a string, a comma separated list or an array, without duplicates", async () => {
        let r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", mentionUsers: "@a:x, @b:x" });
        assert.deepStrictEqual(r.sent[0]["m.mentions"], { user_ids: ["@a:x", "@b:x"] });
        r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", eventId: "$in", userId: "@a:x", replyTo: true, mentionUsers: ["@a:x"], mentionRoom: true });
        assert.deepStrictEqual(r.sent[0]["m.mentions"], { user_ids: ["@a:x"], room: true });
    });

    it("sends an invalid user ID to the error output", async () => {
        const r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", mentionUsers: "alice" });
        assert.strictEqual(r.sent.length, 0);
        assert.match(r.err.error, /not a valid user ID/);
    });

    it("a reply inside a thread keeps the thread", async () => {
        const r = await send(NEW_DEFAULTS, { topic: "!r:x", payload: "hi", eventId: "$in", userId: "@a:x", isThread: true, replyTo: true,
            content: { "m.relates_to": { rel_type: "m.thread", event_id: "$root" } } });
        assert.deepStrictEqual(r.sent[0]["m.relates_to"], { rel_type: "m.thread", event_id: "$root", is_falling_back: false, "m.in_reply_to": { event_id: "$in" } });
    });

    it("a content object in msg.payload gets the reply without msg.payload changing", async () => {
        const payload = { msgtype: "m.file", body: "f.txt", url: "mxc://x/y" };
        const r = await send(NEW_DEFAULTS, { topic: "!r:x", payload, eventId: "$in", userId: "@a:x", replyTo: true });
        assert.deepStrictEqual(r.sent[0]["m.relates_to"], { "m.in_reply_to": { event_id: "$in" } });
        assert.strictEqual(r.ok.payload["m.relates_to"], undefined);
    });

    it("keeps m.relates_to and m.mentions already in a content object", async () => {
        const payload = { msgtype: "m.text", body: "x", "m.relates_to": { rel_type: "m.replace", event_id: "$old" }, "m.mentions": {} };
        const r = await send(NEW_DEFAULTS, { topic: "!r:x", payload, eventId: "$in", userId: "@a:x", replyTo: true, mentionUsers: "@b:x" });
        assert.deepStrictEqual(r.sent[0]["m.relates_to"], { rel_type: "m.replace", event_id: "$old" });
        assert.deepStrictEqual(r.sent[0]["m.mentions"], {});
    });

    it("edits put mentions in m.new_content so nobody is notified again", async () => {
        const r = await send({ ...NEW_DEFAULTS, replaceMessage: true }, { topic: "!r:x", payload: "fixed", eventId: "$old", replyTo: true, mentionUsers: "@b:x" });
        assert.strictEqual(r.sent[0]["m.relates_to"].rel_type, "m.replace");
        assert.deepStrictEqual(r.sent[0]["m.new_content"]["m.mentions"], { user_ids: ["@b:x"] });
        assert.deepStrictEqual(r.sent[0]["m.mentions"], {});
    });
});
