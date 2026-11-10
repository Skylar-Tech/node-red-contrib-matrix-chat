/**
 * Shared helpers for sending replies (`m.in_reply_to`) and intentional
 * mentions (`m.mentions`) from the send nodes.
 *
 * Spec references:
 *  - Rich replies: https://spec.matrix.org/latest/client-server-api/#rich-replies
 *    (reply fallbacks in the body were removed in v1.13, so none are added)
 *  - User and room mentions: https://spec.matrix.org/latest/client-server-api/#user-and-room-mentions
 */

/**
 * Work out which event a message should reply to.
 *
 * @param {*} value the configured "Reply to" value: `true` replies to
 *   `msg.eventId`, a string starting with "$" replies to that event ID, and
 *   anything else means "no reply".
 * @param {object} msg the incoming message
 * @returns {string|null} the event ID to reply to
 */
function resolveReplyTarget(value, msg) {
    if (value === true || value === 'true') {
        return (typeof msg.eventId === 'string' && msg.eventId) ? msg.eventId : null;
    }
    if (typeof value === 'string' && value.startsWith('$')) {
        return value;
    }
    return null;
}

/**
 * Normalise the "Mention users" input into an array of user IDs.
 * Accepts a single user ID, an array of user IDs, or a comma separated list.
 *
 * @returns {string[]}
 */
function normaliseUserIds(value) {
    if (value === undefined || value === null || value === '' || value === false) {
        return [];
    }
    let list = Array.isArray(value) ? value : String(value).split(',');
    let ids = [];
    for (let id of list) {
        if (typeof id !== 'string') {
            throw new Error(`Mentioned users must be user IDs (strings), got ${JSON.stringify(id)}`);
        }
        id = id.trim();
        if (!id) {
            continue;
        }
        if (!id.startsWith('@') || id.indexOf(':') === -1) {
            throw new Error(`"${id}" is not a valid user ID (expected @user:server)`);
        }
        if (!ids.includes(id)) {
            ids.push(id);
        }
    }
    return ids;
}

/**
 * Find the sender of an event, first from the incoming msg (Receive sets
 * msg.userId for msg.eventId), then the room's loaded timeline, then the
 * server. Returns null if it cannot be found.
 */
async function findEventSender(client, roomId, eventId, msg) {
    if (msg && msg.eventId === eventId && typeof msg.userId === 'string' && msg.topic === roomId) {
        return msg.userId;
    }
    const room = client.getRoom(roomId);
    const local = room && room.findEventById(eventId);
    if (local) {
        return local.getSender() || null;
    }
    try {
        const raw = await client.fetchRoomEvent(roomId, eventId);
        return (raw && raw.sender) || null;
    } catch (e) {
        return null;
    }
}

/**
 * Add a reply relation and/or `m.mentions` to message content, in place.
 *
 * Nothing is added unless a reply or a mention was requested, so content sent
 * by existing flows is unchanged. Keys the content already has (for example
 * a full content object passed in msg.payload) are never overwritten.
 *
 * @param {object} opts
 * @param {object} opts.client the MatrixClient
 * @param {string} opts.roomId room the content is sent to
 * @param {object} opts.content message content to modify
 * @param {object} opts.msg the incoming message
 * @param {string|null} opts.replyTo event ID to reply to
 * @param {string[]} opts.mentionUsers user IDs to mention
 * @param {boolean} opts.mentionRoom whether to mention the whole room (@room)
 * @param {boolean} opts.notifyReplySender mention the sender of the replied-to event
 * @param {boolean} [opts.isEdit] content is an edit (m.replace): mentions go
 *   into m.new_content and nobody is notified again
 * @returns {Promise<{replyTo: string|null, mentions: object|null}>} what was applied
 */
async function applyReplyAndMentions(opts) {
    const { client, roomId, content, msg, replyTo, mentionUsers, mentionRoom, notifyReplySender, isEdit } = opts;
    let applied = { replyTo: null, mentions: null };

    let userIds = (mentionUsers || []).slice();

    if (replyTo && !isEdit) {
        let relatesTo = content['m.relates_to'];
        if (!relatesTo) {
            content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo } };
            applied.replyTo = replyTo;
        } else if (relatesTo.rel_type === 'm.thread') {
            // A reply inside a thread: keep the thread relation, point the
            // reply at the requested event and mark it as a real reply.
            relatesTo['m.in_reply_to'] = { event_id: replyTo };
            relatesTo.is_falling_back = false;
            applied.replyTo = replyTo;
        }
        // Any other relation (edit, reaction, ...) cannot also be a reply.

        if (applied.replyTo && notifyReplySender !== false) {
            const sender = await findEventSender(client, roomId, replyTo, msg);
            const ownUserId = client.getUserId && client.getUserId();
            if (sender && sender !== ownUserId && !userIds.includes(sender)) {
                userIds.push(sender);
            }
        }
    }

    if (!userIds.length && !mentionRoom) {
        return applied;
    }

    const mentions = {};
    if (userIds.length) {
        mentions.user_ids = userIds;
    }
    if (mentionRoom) {
        mentions.room = true;
    }

    if (isEdit) {
        // The full set belongs in the new content; an empty top-level
        // m.mentions stops the edit from notifying everyone a second time.
        if (content['m.new_content'] && !content['m.new_content']['m.mentions']) {
            content['m.new_content']['m.mentions'] = mentions;
        }
        if (!content['m.mentions']) {
            content['m.mentions'] = {};
        }
    } else if (!content['m.mentions']) {
        content['m.mentions'] = mentions;
    }
    applied.mentions = content['m.mentions'];
    return applied;
}

module.exports = {
    resolveReplyTarget,
    normaliseUserIds,
    applyReplyAndMentions,
};
