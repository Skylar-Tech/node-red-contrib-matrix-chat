const assert = require("assert");
const { helper, runNode } = require("./helpers/run-node.js");

const CONFIG = { roomType: "msg", roomValue: "topic", eventIdType: "msg", eventIdValue: "eventId" };

function stubClient() {
    const calls = { receipts: [], requests: [] };
    const events = {
        "$main": { getContent: () => ({ body: "hi" }) },
        "$inThread": { getContent: () => ({ body: "hi", "m.relates_to": { rel_type: "m.thread", event_id: "$root" } }) },
    };
    const client = {
        getRoom: (id) => id === "!r:x" ? { findEventById: (e) => events[e] } : null,
        fetchRoomEvent: async () => { throw new Error("M_NOT_FOUND"); },
        sendReceipt: async (event, type) => { calls.receipts.push({ event, type }); },
        http: { authedRequest: async (method, path, query, body) => { calls.requests.push({ method, path, body }); return {}; } },
    };
    return { client, calls };
}

describe("Mark Read", function() {
    this.timeout(10000);
    after(() => helper.unload());

    it("an old node sends a public receipt", async () => {
        const { client, calls } = stubClient();
        const r = await runNode("matrix-mark-read", CONFIG, { topic: "!r:x", eventId: "$main" }, client);
        assert.ok(r.ok);
        assert.strictEqual(calls.receipts[0].type, "m.read");
    });

    it("sends a private receipt", async () => {
        const { client, calls } = stubClient();
        await runNode("matrix-mark-read", { ...CONFIG, receiptType: "m.read.private" }, { topic: "!r:x", eventId: "$main" }, client);
        assert.strictEqual(calls.receipts[0].type, "m.read.private");
    });

    it("a threaded receipt marks the event's thread as read", async () => {
        const { client, calls } = stubClient();
        const r = await runNode("matrix-mark-read", { ...CONFIG, threaded: true, receiptType: "m.read.private" }, { topic: "!r:x", eventId: "$inThread" }, client);
        assert.strictEqual(calls.receipts.length, 0);
        assert.deepStrictEqual(calls.requests[0], {
            method: "POST", path: "/rooms/!r%3Ax/receipt/m.read.private/%24inThread", body: { thread_id: "$root" },
        });
        assert.strictEqual(r.ok.threadId, "$root");
    });

    it("a threaded receipt for an event outside a thread marks the main timeline", async () => {
        const { client, calls } = stubClient();
        const r = await runNode("matrix-mark-read", { ...CONFIG, threaded: true }, { topic: "!r:x", eventId: "$main" }, client);
        assert.deepStrictEqual(calls.requests[0].body, { thread_id: "main" });
        assert.strictEqual(r.ok.threadId, "main");
    });

    it("sends an unknown room or event to the error output", async () => {
        let r = await runNode("matrix-mark-read", CONFIG, { topic: "!nope:x", eventId: "$main" }, stubClient().client);
        assert.match(r.err.error, /Room !nope:x not found/);
        r = await runNode("matrix-mark-read", CONFIG, { topic: "!r:x", eventId: "$gone" }, stubClient().client);
        assert.match(r.err.error, /Event \$gone not found/);
    });
});
