const assert = require("assert");
const { helper, runNode } = require("./helpers/run-node.js");

// A node saved before replies and mentions existed.
const OLD_CONFIG = {
    roomId: "!r:x", latitudeType: "msg", latitudeValue: "latitude", longitudeType: "msg", longitudeValue: "longitude",
    altitudeType: "msg", altitudeValue: "altitude", geoUriType: "msg", geoUriValue: "geo_uri", descriptionType: "msg",
    descriptionValue: "description", assetTypeType: "msg", assetTypeValue: "assetType", timestampType: "msg",
    timestampValue: "timestamp", textType: "msg", textValue: "payload",
};
const CONFIG = {
    ...OLD_CONFIG, replyToType: "msg", replyToValue: "replyTo", notifyReplySender: true,
    mentionUsersType: "msg", mentionUsersValue: "mentionUsers", mentionRoomType: "msg", mentionRoomValue: "mentionRoom",
};

async function send(config, msg) {
    const sent = [];
    const client = {
        getUserId: () => "@bot:x",
        getRoom: () => null,
        fetchRoomEvent: async () => ({ sender: "@zed:x" }),
        sendMessage: async (room, content) => { sent.push(content); return { event_id: "$e" }; },
    };
    return { sent, ...await runNode("matrix-send-location", config, msg, client) };
}

describe("Send Location", function() {
    this.timeout(10000);
    after(() => helper.unload());

    it("sends a location", async () => {
        const r = await send(CONFIG, { latitude: 1, longitude: 2 });
        assert.ok(r.ok);
        assert.strictEqual(r.sent[0].geo_uri, "geo:1,2");
        assert.strictEqual(r.ok.eventId, "$e");
    });

    for (const [label, config, msg, error] of [
        ["a broken property lookup", { latitudeType: "flow", latitudeValue: "a[[" }, {}, /./],
        ["a latitude out of range", {}, { latitude: 95, longitude: 1 }, /latitude/i],
        ["a longitude out of range", {}, { latitude: 1, longitude: 200 }, /longitude/i],
        ["an unknown asset type", {}, { latitude: 1, longitude: 2, assetType: "m.bogus" }, /asset/i],
        ["an invalid mention", {}, { latitude: 1, longitude: 2, mentionUsers: "nope" }, /not a valid user ID/],
    ]) {
        it(`sends ${label} to the error output with msg.error and a Catch error`, async () => {
            const r = await send({ ...CONFIG, ...config }, msg);
            assert.strictEqual(r.sent.length, 0);
            assert.ok(r.err, "no error output");
            assert.match(r.err.error, error);
            assert.strictEqual(r.errors.length, 1);
        });
    }

    it("replies and mentions", async () => {
        const r = await send(CONFIG, { latitude: 1, longitude: 2, eventId: "$in", userId: "@a:x", topic: "!r:x", replyTo: true, mentionUsers: "@b:x" });
        assert.deepStrictEqual(r.sent[0]["m.relates_to"], { "m.in_reply_to": { event_id: "$in" } });
        assert.deepStrictEqual(r.sent[0]["m.mentions"].user_ids.slice().sort(), ["@a:x", "@b:x"]);
    });

    it("an old node does not reply or pass on msg.mentions from Receive", async () => {
        const r = await send(OLD_CONFIG, { latitude: 1, longitude: 2, eventId: "$in", userId: "@a:x", mentions: { room: true } });
        assert.strictEqual(r.sent[0]["m.relates_to"], undefined);
        assert.strictEqual(r.sent[0]["m.mentions"], undefined);
    });
});
