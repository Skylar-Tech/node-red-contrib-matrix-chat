const assert = require('assert');
const { helper, uid, SERVER_NAME, api, enc, realClient, runNode } = require('./helpers.js');

describe('live: room alias, directory, summary, space hierarchy', function () {
    this.timeout(60000);
    let bot, peer, room, alias;
    const tag = Date.now().toString(36);
    before(async () => {
        bot = await realClient('bot');
        global.__matrixClient = bot.client;
        peer = await realClient('peer');
        room = (await bot.client.createRoom({ preset: 'public_chat', name: 'Directory test ' + tag, topic: 'a topic' })).room_id;
        alias = `#nrtest-${tag}:${SERVER_NAME}`;
    });
    after(() => helper.unload());

    it('alias: create, resolve, list, delete', async () => {
        let r = await runNode('matrix-room-alias', { action: 'create' }, { topic: room, alias });
        assert.ok(r.ok, r.err && r.err.error);
        assert.deepStrictEqual(r.ok.payload, { alias, roomId: room });
        r = await runNode('matrix-room-alias', { action: 'resolve', alias }, { payload: 'x' });
        assert.ok(r.ok, r.err && r.err.error);
        assert.strictEqual(r.ok.topic, room);
        assert.deepStrictEqual(r.ok.payload.servers, [SERVER_NAME]);
        r = await runNode('matrix-room-alias', { action: 'msg.action' }, { action: 'list', topic: room });
        assert.deepStrictEqual(r.ok.payload, [alias]);
        r = await runNode('matrix-room-alias', { action: 'create' }, { topic: room, alias });
        assert.match(r.err.error, /^Room alias error: .*M_UNKNOWN|already/i);
        r = await runNode('matrix-room-alias', { action: 'delete' }, { alias });
        assert.ok(r.ok, r.err && r.err.error);
        r = await runNode('matrix-room-alias', { action: 'resolve' }, { alias });
        assert.match(r.err.error, /M_NOT_FOUND/);
        r = await runNode('matrix-room-alias', { action: 'resolve' }, { alias: 'nohash' });
        assert.match(r.err.error, /must look like #name:server/);
    });

    it('directory: publish, visibility, search, unpublish', async () => {
        let r = await runNode('matrix-room-directory', { action: 'publish' }, { topic: room });
        assert.ok(r.ok, r.err && r.err.error);
        r = await runNode('matrix-room-directory', { action: 'visibility' }, { topic: room });
        assert.strictEqual(r.ok.payload, 'public');
        r = await runNode('matrix-room-directory', { action: 'search', limit: 5 }, { payload: 'Directory test ' + tag });
        assert.ok(r.ok, r.err && r.err.error);
        assert.strictEqual(r.ok.payload.length, 1);
        assert.strictEqual(r.ok.payload[0].room_id, room);
        assert.strictEqual(r.ok.payload[0].topic, 'a topic');
        // a timestamp payload (from an Inject node) lists everything
        r = await runNode('matrix-room-directory', { action: 'search', limit: 1 }, { payload: Date.now() });
        assert.strictEqual(r.ok.payload.length, 1);
        assert.ok(r.ok.nextBatch === null || typeof r.ok.nextBatch === 'string');
        r = await runNode('matrix-room-directory', { action: 'unpublish' }, { topic: room });
        assert.strictEqual(r.ok.payload, 'private');
        r = await runNode('matrix-room-directory', { action: 'visibility' }, { topic: room });
        assert.strictEqual(r.ok.payload, 'private');
    });

    it('summary: by ID, by alias, of a room the bot is not in, and an unknown room', async () => {
        await runNode('matrix-room-alias', { action: 'create' }, { topic: room, alias });
        let r = await runNode('matrix-room-summary', {}, { topic: alias });
        assert.ok(r.ok, r.err && r.err.error);
        assert.strictEqual(r.ok.topic, room);
        assert.strictEqual(r.ok.payload.name, 'Directory test ' + tag);
        assert.strictEqual(r.ok.payload.membership, 'join');
        const other = (await api(peer.token, 'POST', '/_matrix/client/v3/createRoom', { preset: 'public_chat', name: 'peer public' })).json.room_id;
        r = await runNode('matrix-room-summary', {}, { topic: other });
        assert.ok(r.ok, r.err && r.err.error);
        assert.strictEqual(r.ok.payload.name, 'peer public');
        assert.strictEqual(r.ok.payload.num_joined_members, 1);
        r = await runNode('matrix-room-summary', {}, { topic: `!nope:${SERVER_NAME}` });
        assert.match(r.err.error, /^Room summary error: /);
        await runNode('matrix-room-alias', { action: 'delete' }, { alias });
    });

    it('space hierarchy: lists children, pages with Max rooms and continues', async () => {
        const space = (await bot.client.createRoom({ preset: 'public_chat', name: 'Space ' + tag, creation_content: { type: 'm.space' } })).room_id;
        const kids = [];
        for (const name of ['kid a', 'kid b', 'kid c']) {
            const id = (await bot.client.createRoom({ preset: 'public_chat', name })).room_id;
            kids.push(id);
            await api(bot.token, 'PUT', `/_matrix/client/v3/rooms/${enc(space)}/state/m.space.child/${enc(id)}`, { via: [SERVER_NAME], suggested: name === 'kid b' });
        }
        let r = await runNode('matrix-space-hierarchy', { limit: 100 }, { topic: space });
        assert.ok(r.ok, r.err && r.err.error);
        assert.strictEqual(r.ok.payload[0].room_id, space);
        assert.deepStrictEqual(r.ok.payload.slice(1).map((x) => x.room_id).sort(), kids.slice().sort());
        assert.strictEqual(r.ok.nextBatch, null);
        r = await runNode('matrix-space-hierarchy', { limit: 2 }, { topic: space });
        assert.strictEqual(r.ok.payload.length, 2);
        assert.ok(r.ok.nextBatch, 'expected a nextBatch');
        const first = r.ok.payload.map((x) => x.room_id);
        r = await runNode('matrix-space-hierarchy', { limit: 2 }, { topic: space, nextBatch: r.ok.nextBatch });
        const second = r.ok.payload.map((x) => x.room_id);
        assert.deepStrictEqual(first.concat(second).sort(), [space].concat(kids).sort());
        r = await runNode('matrix-space-hierarchy', { suggestedOnly: true }, { topic: space });
        assert.deepStrictEqual(r.ok.payload.map((x) => x.name), ['Space ' + tag, 'kid b']);
    });
});
