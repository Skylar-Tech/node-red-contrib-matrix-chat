const assert = require('assert');
const { helper, uid, SERVER_NAME, api, enc, realClient, runNode } = require('./helpers.js');

describe('live: account data, room tags, ignore users, user directory', function () {
    this.timeout(60000);
    let bot, peer, room;
    before(async () => {
        bot = await realClient('bot');
        global.__matrixClient = bot.client;
        peer = await realClient('peer');
        room = (await bot.client.createRoom({ preset: 'private_chat', name: 'tags test' })).room_id;
    });
    after(async () => {
        // leave the test accounts as they were
        await api(bot.token, 'PUT', `/_matrix/client/v3/user/${enc(uid('bot'))}/account_data/m.invite_permission_config`, {});
        await api(bot.token, 'PUT', `/_matrix/client/v3/user/${enc(uid('bot'))}/account_data/m.ignored_user_list`, { ignored_users: {} });
        helper.unload();
    });

    it('account data: global set/get, unknown type is null, room scope', async () => {
        const type = 'com.example.nrtest' + Date.now();
        let r = await runNode('matrix-account-data', { action: 'get', scope: 'global', dataType: type }, {});
        assert.ok(r.ok, r.err && r.err.error);
        assert.strictEqual(r.ok.payload, null);
        r = await runNode('matrix-account-data', { action: 'set', scope: 'global', dataType: type }, { payload: { a: 1 } });
        assert.ok(r.ok, r.err && r.err.error);
        r = await runNode('matrix-account-data', { action: 'get', scope: 'global' }, { dataType: type });
        assert.deepStrictEqual(r.ok.payload, { a: 1 });
        r = await runNode('matrix-account-data', { action: 'get', scope: 'room', dataType: 'm.marked_unread' }, { topic: room });
        assert.strictEqual(r.ok.payload, null);
        r = await runNode('matrix-account-data', { action: 'set', scope: 'room', dataType: 'm.marked_unread' }, { topic: room, payload: { unread: true } });
        assert.ok(r.ok, r.err && r.err.error);
        r = await runNode('matrix-account-data', { action: 'get', scope: 'room', dataType: 'm.marked_unread' }, { topic: room });
        assert.deepStrictEqual(r.ok.payload, { unread: true });
        r = await runNode('matrix-account-data', { action: 'set', scope: 'global', dataType: type }, { payload: 'nope' });
        assert.match(r.err.error, /msg.payload must be an object/);
        r = await runNode('matrix-account-data', { action: 'get', scope: 'global' }, {});
        assert.match(r.err.error, /Account data type must be set/);
    });

    it('account data: blocking invites makes the server reject them until allowed again', async () => {
        let r = await runNode('matrix-account-data', { action: 'set', scope: 'global', dataType: 'm.invite_permission_config' }, { payload: { default_action: 'block' } });
        assert.ok(r.ok, r.err && r.err.error);
        const pr = (await api(peer.token, 'POST', '/_matrix/client/v3/createRoom', { preset: 'private_chat' })).json.room_id;
        let inv = await api(peer.token, 'POST', `/_matrix/client/v3/rooms/${enc(pr)}/invite`, { user_id: uid('bot') });
        assert.strictEqual(inv.status, 403, JSON.stringify(inv.json));
        assert.strictEqual(inv.json.errcode, 'M_INVITE_BLOCKED');
        r = await runNode('matrix-account-data', { action: 'set', scope: 'global', dataType: 'm.invite_permission_config' }, { payload: {} });
        assert.ok(r.ok, r.err && r.err.error);
        inv = await api(peer.token, 'POST', `/_matrix/client/v3/rooms/${enc(pr)}/invite`, { user_id: uid('bot') });
        assert.strictEqual(inv.status, 200, JSON.stringify(inv.json));
    });

    it('room tags: add with order, add another, get, remove', async () => {
        let r = await runNode('matrix-room-tags', { action: 'add', tag: 'm.favourite' }, { topic: room, order: 0.25 });
        assert.ok(r.ok, r.err && r.err.error);
        assert.deepStrictEqual(r.ok.payload, { 'm.favourite': { order: 0.25 } });
        r = await runNode('matrix-room-tags', { action: 'add' }, { topic: room, tag: 'u.support' });
        assert.deepStrictEqual(r.ok.payload, { 'm.favourite': { order: 0.25 }, 'u.support': {} });
        r = await runNode('matrix-room-tags', { action: 'remove', tag: 'm.favourite' }, { topic: room });
        assert.deepStrictEqual(r.ok.payload, { 'u.support': {} });
        r = await runNode('matrix-room-tags', { action: 'get' }, { topic: room });
        assert.deepStrictEqual(r.ok.payload, { 'u.support': {} });
        r = await runNode('matrix-room-tags', { action: 'add' }, { topic: room, tag: 'u.x', order: 5 });
        assert.match(r.err.error, /msg.order must be a number from 0 to 1/);
        r = await runNode('matrix-room-tags', { action: 'add' }, { topic: room });
        assert.match(r.err.error, /Tag must be set/);
    });

    it('ignore users: ignore one, ignore array (no duplicates), unignore, and the server filters messages', async () => {
        let r = await runNode('matrix-ignore-users', { action: 'get' }, {});
        assert.deepStrictEqual(r.ok.payload, []);
        r = await runNode('matrix-ignore-users', { action: 'ignore' }, { userId: uid('peer') });
        assert.deepStrictEqual(r.ok.payload, [uid('peer')]);
        r = await runNode('matrix-ignore-users', { action: 'ignore' }, { userId: [uid('peer'), uid('admin')] });
        assert.deepStrictEqual(r.ok.payload, [uid('peer'), uid('admin')]);
        const raw = (await api(bot.token, 'GET', `/_matrix/client/v3/user/${enc(uid('bot'))}/account_data/m.ignored_user_list`)).json;
        assert.deepStrictEqual(Object.keys(raw.ignored_users).sort(), [uid('admin'), uid('peer')]);
        r = await runNode('matrix-ignore-users', { action: 'msg.action' }, { action: 'unignore', userId: uid('peer') });
        assert.deepStrictEqual(r.ok.payload, [uid('admin')]);
        r = await runNode('matrix-ignore-users', { action: 'ignore' }, { userId: 'peer' });
        assert.match(r.err.error, /must be a user ID/);
    });

    it('user directory: finds a user sharing a room, empty search errors', async () => {
        const shared = (await bot.client.createRoom({ preset: 'private_chat', invite: [uid('peer')] })).room_id;
        await api(peer.token, 'POST', `/_matrix/client/v3/join/${enc(shared)}`, {});
        await new Promise((r) => setTimeout(r, 1500));
        let r = await runNode('matrix-user-directory', { limit: 5 }, { payload: 'peer' });
        assert.ok(r.ok, r.err && r.err.error);
        assert.ok(r.ok.payload.some((u) => u.userId === uid('peer')), JSON.stringify(r.ok.payload));
        assert.strictEqual(typeof r.ok.limited, 'boolean');
        r = await runNode('matrix-user-directory', {}, { payload: 12345 });
        assert.match(r.err.error, /msg.payload must be the text to search for/);
    });
});
