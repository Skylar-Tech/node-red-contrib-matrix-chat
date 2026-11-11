const assert = require('assert');
const { helper, uid, SERVER_NAME, realClient, runNode } = require('./helpers.js');

const rule = (t, p, to, tot) => ({ t, p, to, tot });

describe('live: user settings presence', function () {
    this.timeout(60000);
    let bot;
    before(async () => {
        bot = await realClient('bot');
        global.__matrixClient = bot.client;
    });
    after(() => helper.unload());

    it('sets presence and status, gets them back, and keeps one when setting the other', async () => {
        let r = await runNode('matrix-user-settings', { rules: [
            rule('set', 'presence', 'unavailable', 'str'), rule('set', 'status_msg', 'Back at 9am', 'str'),
            rule('get', 'presence', 'presence', 'msg'), rule('get', 'status_msg', 'status', 'msg')] }, {});
        assert.ok(r.ok, r.err && r.err.error);
        assert.strictEqual(r.ok.setter_errors, undefined, JSON.stringify(r.ok.setter_errors));
        assert.strictEqual(r.ok.presence, 'unavailable');
        assert.strictEqual(r.ok.status, 'Back at 9am');

        await new Promise((res) => setTimeout(res, 11000)); // Synapse allows one presence change per 10s
        r = await runNode('matrix-user-settings', { rules: [
            rule('set', 'presence', 'online', 'str'), rule('get', 'status_msg', 'status', 'msg'), rule('get', 'presence', 'presence', 'msg')] }, {});
        assert.strictEqual(r.ok.presence, 'online');
        assert.strictEqual(r.ok.status, 'Back at 9am', 'status was lost when setting presence');

        await new Promise((res) => setTimeout(res, 11000));
        r = await runNode('matrix-user-settings', { rules: [
            rule('set', 'status_msg', 'payload', 'msg'), rule('get', 'status_msg', 'status', 'msg'), rule('get', 'presence', 'presence', 'msg')] }, { payload: '' });
        assert.strictEqual(r.ok.status, false);
        assert.strictEqual(r.ok.presence, 'online', 'presence was lost when setting status');
    });

    it('rejects an invalid presence in setter_errors', async () => {
        const r = await runNode('matrix-user-settings', { rules: [rule('set', 'presence', 'busy', 'str')] }, {});
        assert.match(r.ok.setter_errors.presence, /presence must be "online", "unavailable" or "offline"/);
    });
});
