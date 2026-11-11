const assert = require('assert');
const { helper, uid, SERVER_NAME, api, enc, realClient, runNode } = require('./helpers.js');

describe('live: report, unban, knock', function () {
    this.timeout(60000);
    let bot, peer, admin, room;
    before(async () => {
        bot = await realClient('bot');
        global.__matrixClient = bot.client;
        peer = await realClient('peer');
        admin = await realClient('admin');
        // a room the peer owns, with the bot as member
        room = (await api(peer.token, 'POST', '/_matrix/client/v3/createRoom', { preset: 'public_chat', name: 'mod test ' + Date.now() })).json.room_id;
        await api(bot.token, 'POST', `/_matrix/client/v3/join/${enc(room)}`, {});
    });
    after(() => helper.unload());

    it('reports an event (visible to the server admin)', async () => {
        const ev = (await api(peer.token, 'PUT', `/_matrix/client/v3/rooms/${enc(room)}/send/m.room.message/r${Date.now()}`, { msgtype: 'm.text', body: 'spam spam' })).json.event_id;
        const r = await runNode('matrix-report', { reportType: 'event', reason: 'spam' }, { topic: room, eventId: ev });
        assert.ok(r.ok, r.err && r.err.error);
        const reports = (await api(admin.token, 'GET', '/_synapse/admin/v1/event_reports?dir=b&limit=5')).json;
        const found = reports.event_reports.find((x) => x.event_id === ev);
        assert.ok(found, 'report not found in admin API');
        assert.strictEqual(found.reason, 'spam');
    });

    it('reports a room and a user', async () => {
        let r = await runNode('matrix-report', { reportType: 'room' }, { topic: room, reason: 'bad room' });
        assert.ok(r.ok, r.err && r.err.error);
        r = await runNode('matrix-report', { reportType: 'msg.reportType' }, { reportType: 'user', userId: uid('peer'), reason: 'rude' });
        assert.ok(r.ok, r.err && r.err.error);
    });

    it('report errors are readable', async () => {
        let r = await runNode('matrix-report', { reportType: 'event' }, { topic: room });
        assert.strictEqual(r.err.error, 'msg.eventId must be set to report an event');
        r = await runNode('matrix-report', { reportType: 'msg.reportType' }, { reportType: 'nope', topic: room });
        assert.match(r.err.error, /Report type must be one of/);
        r = await runNode('matrix-report', { reportType: 'event' }, { topic: `!doesnotexist:${SERVER_NAME}`, eventId: '$nope' });
        assert.match(r.err.error, /^Report failed: /);
    });

    it('unbans with a reason', async () => {
        const own = (await bot.client.createRoom({ preset: 'private_chat', name: 'unban test' })).room_id;
        await api(bot.token, 'POST', `/_matrix/client/v3/rooms/${enc(own)}/ban`, { user_id: uid('admin'), reason: 'x' });
        const r = await runNode('matrix-room-unban', { reason: 'second chance' }, { topic: own, userId: uid('admin') });
        assert.ok(r.ok, r.err && r.err.error);
        const m = (await api(bot.token, 'GET', `/_matrix/client/v3/rooms/${enc(own)}/state/m.room.member/${enc(uid('admin'))}`)).json;
        assert.strictEqual(m.membership, 'leave');
        assert.strictEqual(m.reason, 'second chance');
    });

    it('unban errors: bad user ID, no permission', async () => {
        let r = await runNode('matrix-room-unban', {}, { topic: room, userId: 'admin' });
        assert.match(r.err.error, /must be a user ID/);
        r = await runNode('matrix-room-unban', {}, { topic: room, userId: uid('admin') });
        assert.match(r.err.error, /^Error trying to unban: .*M_FORBIDDEN/);
    });

    it('knocks on a knock room with a reason, and the moderator sees it', async () => {
        const kr = (await api(peer.token, 'POST', '/_matrix/client/v3/createRoom', { preset: 'private_chat', name: 'knock test', room_version: '10',
            initial_state: [{ type: 'm.room.join_rules', state_key: '', content: { join_rule: 'knock' } }] })).json.room_id;
        const r = await runNode('matrix-knock-room', {}, { topic: kr, reason: 'please let me in' });
        assert.ok(r.ok, r.err && r.err.error);
        assert.deepStrictEqual(r.ok.payload, { roomId: kr, membership: 'knock' });
        const m = (await api(peer.token, 'GET', `/_matrix/client/v3/rooms/${enc(kr)}/state/m.room.member/${enc(uid('bot'))}`)).json;
        assert.strictEqual(m.membership, 'knock');
        assert.strictEqual(m.reason, 'please let me in');
    });

    it('knocking on a room that does not allow it fails cleanly', async () => {
        const pr = (await api(peer.token, 'POST', '/_matrix/client/v3/createRoom', { preset: 'private_chat', name: 'invite only' })).json.room_id;
        const r = await runNode('matrix-knock-room', {}, { topic: pr });
        assert.match(r.err.error, /^Error knocking on room: /);
    });
});
