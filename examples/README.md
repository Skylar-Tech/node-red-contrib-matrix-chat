# Examples

These examples showcase what is possible with the [node-red-contrib-matrix-chat](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat) module for [Node-RED](https://nodered.org/).

Build something cool with these nodes? Feel free to submit a pull request to share it!

## Prerequisites

- A Matrix account
- Node-RED set up and running
- Installed `node-red-contrib-matrix-chat` module

## How to Use the Examples

To try out any of the examples:

1. Copy the JSON contents from the `.json` file linked in each example.
2. In Node-RED, use the menu to import the flow:
    - Click the hamburger menu (top right corner).
    - Select **Import**.
    - Paste the JSON and click **Import**.

## Index

**Click the ▶ example to ▼ expand**

### User Management

<details>
<summary>Get or set current user display name</summary>

[View JSON](get-set-displayname.json)

This flow lets you get or set the displayname for the current user.

![get-set-displayname.png](get-set-displayname.png)

</details>

<details>
<summary>Set user avatar using URL</summary>

[View JSON](set-avatar-from-url.json)

Inject a URL to an image and Node-RED will fetch the contents, upload to matrix, then set the user avatar to the new mxc_url.

This is a good example of how to use the upload file node.

![set-avatar-from-url.png](set-avatar-from-url.png)

</details>

<details>
<summary>Fetch user info by userId</summary>

[View JSON](get-user.json)

Note this only works for users that the bot shares a room with. It will attempt to fetch the user from local storage first and if not found will query the server for the data.

![get-user.png](get-user.png)

</details>

<details>
<summary>Create User with Shared Secret Registration</summary>

[View JSON](shared-secret-registration.json)

Use this flow to create users on servers with closed registration. You can also use this endpoint to create your first admin user, as it is the same as running the local Python script on the server. This requires your registration secret from your `homeserver.yaml` Synapse server configuration file.

**Instructions:**

1. Edit the object on the inject node to specify the desired username and password.
2. Click the inject button (to the left of the inject node) to create the user.

**Note:** This only works on Synapse servers.

![Shared Secret Registration](shared-secret-registration.png)

</details>

<details>
<summary>Create/Edit Synapse User</summary>

[View JSON](add-user-with-admin-user.json)

Allows an administrator to create or modify a user account with a specified `msg.userId`.

![Create/Edit Synapse User](add-user-with-admin-user.png)

</details>

<details>
<summary>Deactivate User</summary>

[View JSON](deactivate-user.json)

If you send "deactivate_user @test:example.com", the bot will deactivate the `@test:example.com` account on the server.

**Note:**

- This requires the bot to be a server admin.
- **WARNING:** Accounts that are deleted cannot be restored. If you want to temporarily disable a user, consider modifying the user instead.

![Deactivate User](deactivate-user.png)

</details>

<details>
<summary>Force User to Join Room</summary>

[View JSON](force-join-room.json)

If you send "force_join @test:example.com !320j90mf0394f:example.com", the bot will force the user `@test:example.com` into room `!320j90mf0394f:example.com`.

**Note:**

- This requires the bot to be a server admin.
- This only works for rooms on the same server.

![Force User to Join Room](force-join-room.png)

</details>

### Message Handling

<details>
<summary>Upload file and send to room</summary>

[View JSON](send-image-to-room.json)

This flow will download an image from a given URL and upload it to the matrix server then send it to a room.

This isn't just for images and supports any sort of file format. Videos, images, and audio files will have metadata detected automatically and appended to the message (duration, dimensions, thumbnail, etc)

![img.png](send-image-to-room.png)

</details>

<details>
<summary>Respond to "ping" with "pong"</summary>

[View JSON](respond-ping-pong.json)

Use this flow to respond to anyone who says "ping" with "pong" in the same room.

![Respond to "ping" with "pong"](respond-ping-pong.png)

</details>

<details>
<summary>Respond to "html" with an HTML Message</summary>

[View JSON](respond-to-html-with-html.json)

Use this flow to respond to anyone who says "html" with an example HTML message. This shows how easy it is to send HTML content.

![Respond to "html" with HTML Message](respond-to-html-with-html.png)

</details>

<details>
<summary>Respond to "react" with a Reaction</summary>

[View JSON](respond-react-with-reaction.json)

Gives a 👍 reaction when someone says "react".

![Respond to "react" with Reaction](respond-react-with-reaction.png)

</details>

<details>
<summary>Remove Messages Containing "delete"</summary>

[View JSON](delete-event.json)

Any messages containing "delete" will be removed by the client.

**Note:** The bot needs appropriate permissions to remove messages.

![Remove Messages Containing "delete"](delete-event.png)

</details>

### Event Handling

<details>
<summary>Sending Typing Events to a Room</summary>

[View JSON](send-typing-events.json)

You can indicate to a room that the bot is typing and also cancel the typing event. This can be useful for making bots feel more interactive (e.g., show typing while requesting an API endpoint).

![Sending Typing Events](send-typing-events.png)

</details>

<details>
<summary>Mark all received events as read</summary>

[View JSON](mark-all-read.json)

With this flow anytime an event is received by the bot it will mark it as read.

![mark-all-read.png](mark-all-read.png)

</details>

<details>
<summary>Fetch event by eventId and roomId</summary>

[View JSON](get-event.json)

Fetch an event from Matrix by eventId and roomId

**Instructions:**

- Change the inject node to contain a proper eventId and roomId (topic)
- Inject the payload and you should see the result contain the event data

![get-event.png](get-event.png)

</details>

<details>
<summary>Paginate the entire history of a given room</summary>

[View JSON](paginate-room-history.json)

This flow iterates the entire history of a room (outputting for every page we hit).

There is a configurable delay (currently set at 1000ms) in this flow. This is recommended, so you are not bogging down the server.

![paginate-room-history.png](paginate-room-history.png)

</details>

<details>
<summary>Paginate related events to a given eventId</summary>

[View JSON](fetch-event-relations.json)

Paginate through the related events to a given eventId. Related events being reactions, thread messages, message modifications, message removals, etc. This outputs once per iterated page.

If you would rather have it output one massive list at the end of pagination use this flow:
[View Aggregated Flow JSON](fetch-event-relations-aggregated.json)

**Instructions:**

- Change the inject node to contain a proper eventId and roomId (topic)
- Inject the payload and you should see the result contain a list of related events for the given eventId

![fetch-event-relations.png](fetch-event-relations.png)

</details>

### Room Management

<details>
<summary>Set room name and topic</summary>

[View JSON](set-room-name-and-topic.json)

Changes the specified room's name and topic to the injected values.

There are a bunch of different settings you can change, this is just an example for these two fields to show how it's done.

This node can also be used to read these values.

![set-room-name-and-topic.png](set-room-name-and-topic.png)

</details>

<details>
<summary>Accept Room Invites from Specific User</summary>

[View JSON](accept-room-invites.json)

Automatically accept room invites from a specific user.

![Accept Room Invites from Specific User](accept-room-invites.png)

</details>

<details>
<summary>Leave Room When Someone Says "bye"</summary>

[View JSON](leave-room-bye.json)

Leaves the room when someone says "bye".

![Leave Room When Someone Says "bye"](leave-room-bye.png)

</details>

<details>
<summary>Respond to "newroom" by Creating a New Room and Inviting User</summary>

[View JSON](respond-newroom-invite.json)

When someone sends "newroom", a new room will be created, and the user who sent the message will be invited. The bot will also send a welcome message into the new room.

![Respond to "newroom" by Creating New Room](respond-newroom-invite.png)

</details>

<details>
<summary>Respond to "joinroom &lt;room_id_or_alias&gt;" by Joining Mentioned Room</summary>

[View JSON](respond-joinroom.json)

When someone sends "joinroom &lt;room_id_or_alias&gt;", the bot will join the mentioned room.

![Respond to "joinroom" by Joining Room](respond-joinroom.png)

</details>

<details>
<summary>Kick/Ban User from Room</summary>

[View JSON](room-kick-ban.json)

- If you say "kick @test:example.com", the bot will kick `@test:example.com` from the current room.
- If you say "ban @test:example.com", the bot will ban `@test:example.com` from the current room.

**Note:** This requires the bot to have permissions to kick/ban in the current room.

![Kick/Ban User from Room](room-kick-ban.png)

</details>

### User Information

<details>
<summary>Respond to "users" with Full List of Server Users</summary>

[View JSON](respond-users-list.json)

When someone sends the text "users", they receive an HTML message containing all the current users on the server. If your server has many users, this paginates and sends messages with 25 users per message.

**Notes:**

- This requires admin privileges.
- If there are many users, the bot may send multiple messages due to message size limits.

![Respond to "users" with User List](respond-users-list.png)

</details>

<details>
<summary>Respond to "whois &lt;user_id&gt;" with Information about the User's Session</summary>

[View JSON](respond-whois.json)

Lists out the user's session info, including IP address, last seen time, and user agent. Useful for finding out more about a specific user on your server.

**Notes:**

- This requires admin privileges.
- If the user has many sessions, the message may be too large to send in one piece.

![Respond to "whois" with User Session Info](respond-whois.png)

</details>

<details>
<summary>Respond to "rooms &lt;user_id&gt;" with User's Rooms</summary>

[View JSON](respond-rooms.json)

Responds to "rooms &lt;user_id&gt;" with that user's rooms. If the message is just "rooms", it responds with a list of all rooms the server is participating in.

**Notes:**

- This requires admin privileges.
- If there are many rooms, the message may be too large to send in one piece.
- This only works for users on the current server.

![Respond to "rooms" with Room List](respond-rooms.png)

</details>

<details>
<summary>Respond to "room_users" with Current Room's Users</summary>

[View JSON](respond-room-users.json)

Lists the users participating in the current room.

**Note:** If there are many users in the room, the message may be too large to send.

![Respond to "room_users" with User List](respond-room-users.png)

</details>

### Advanced Features

<details>
<summary>Use Function Node to Run Any Command</summary>

[View JSON](custom-redact-function-node.json)

If there isn't a node for something you want to do, you can use a function node to manually execute commands. For example, you can redact events (remove messages).

**Instructions:**

- Use the function node to write custom commands using the `matrix-js-sdk` client.
- Make sure to catch any errors in your function node to prevent Node-RED from crashing.

To view the available functions, check out the [`client.ts` file from `matrix-js-sdk`](https://github.com/matrix-org/matrix-js-sdk/blob/master/src/client.ts).

![Use Function Node to Run Commands](custom-redact-function-node.png)

</details>

<details>
<summary>Download & Store All Received Files/Images</summary>

[View JSON](store-received-files.json)

Downloads received files/images. If the file is encrypted, it will decrypt it for you. The decrypt node downloads the file; otherwise, you need to use an HTTP Request node to download the file.

**Instructions:**

- You may need to edit the storage directory for this to work.
- By default, files are saved in a `downloads` folder in the Node-RED directory.
- Ensure that Node-RED has permission to write to the specified directory.

![Download & Store Received Files](store-received-files.png)

</details>

### Deprecated

<details>
<summary>Respond to "image" with an uploaded image</summary>

[View JSON](respond-image-with-image.json)

You will need an image on the machine running Node-RED. In this example, `example.png` exists inside the Node-RED directory.

**Instructions:**

1. Place the image file (`example.png`) in the appropriate directory.
2. Import the flow and deploy it.

![Respond to "image" with Uploaded Image](respond-image-with-image.png)

</details>

<details>
<summary>Respond to "file" with an uploaded file</summary>

[View JSON](respond-file-with-file.json)

You will need a file on the machine running Node-RED. In this example, `sample.pdf` exists inside the Node-RED directory.

**Instructions:**

1. Place the file (`sample.pdf`) in the appropriate directory.
2. Import the flow and deploy it.

![Respond to "file" with Uploaded File](respond-file-with-file.png)

</details>
