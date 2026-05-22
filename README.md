# node-red-contrib-matrix-chat
[Matrix](https://matrix.org/) chat server client for [Node-RED](https://nodered.org/)

***Currently in beta. Please report any issues in our repository to help us reach a stable, well-tested release. Breaking changes may occur before our first stable release, so be sure to check the changelog before updating.***

Join our public Matrix room for help: [#node-red-contrib-matrix-chat:skylar.tech](https://app.element.io/#/room/#node-red-contrib-matrix-chat:skylar.tech)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/B0B51BM7C)

### Features

Supported functionality in this package includes:

- **End-to-end encryption (E2EE)** — send and receive encrypted messages (see the [encryption notes](#end-to-end-encryption-notes))
- **Cross-signing & secure backup** — interactive setup from the server config node so the bot's own device shows as verified
- **Device verification** — flow-driven SAS (emoji) verification via the `matrix-verification` and `matrix-verification-action` nodes
- **Receive events** from rooms: Messages, reactions, images, audio, locations, files, encrypted or unencrypted
- **Fetch/modify room state**: Update room settings
- **Paginate room history**
- **Send files** to rooms, encrypted or unencrypted
- **Send/edit messages** (supports plain text and HTML formats)
- **Send typing notifications**
- **Delete events** (messages, reactions, etc.)
- **Decrypt files** in E2EE rooms
- **React to messages**
- **Admin tools**:
  - Register users on closed Synapse servers (`registration_shared_secret`)
  - Manage users, including listing, adding, editing, deactivating (Synapse API)
  - Force-add users to rooms
- **Room management**: Invite, kick, ban, join, create, and leave rooms

These features allow you to easily build bots, set up chat relays, or even administrate your Matrix server directly from [Node-RED](https://nodered.org/).

### Installing

**Requires Node.js 22 or newer** (this is a requirement of the bundled `matrix-js-sdk`).

Install through Node-RED's UI by searching for `node-red-contrib-matrix-chat`, or use the following command inside your Node-RED directory:

```bash
npm install node-red-contrib-matrix-chat
```

### Usage

Explore our [examples](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/tree/master/examples#readme) to see the module in action.

#### Extending functionality

You're not limited to just the nodes we've created. Enable global access in your Matrix Client to directly interact with the client from function nodes and create custom logic.

[View an example here](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/tree/master/examples#use-function-node-to-run-any-command).

### End-to-End Encryption Notes

- E2EE uses the Rust crypto stack from `matrix-js-sdk`. The first time a bot starts after upgrading from an older version, any existing (legacy libolm) crypto state is migrated automatically.
- **Storage:** E2EE state is saved in a folder called `matrix-client-storage` within your Node-RED directory. Each account's Rust crypto store is persisted there as `rust-crypto-store.v8` (snapshotted on shutdown and every 5 minutes). Back up this folder regularly! If lost, you won’t be able to decrypt messages from E2EE rooms.
- To move your bot to a different installation, migrate this folder and ensure the old and new clients don't run simultaneously.
- It’s simplest to dedicate the account to the bot and run it only within Node-RED. The account can also be signed in elsewhere — if so, verify those sessions against the bot (see below) so they trust each other and share keys.
- **Cross-signing & secure backup:** open the server config node and use the **Set up secure backup & cross-signing** button. It checks the account and lets you unlock an existing secure backup with its recovery key, or create a fresh one — after which the bot's own device is cross-signed and shows as verified to others.
- **Device verification:** the `matrix-verification` node emits verification requests and phase changes, and `matrix-verification-action` accepts, starts, confirms, or cancels them — so you can build your own approval flow (e.g. emailing the SAS emoji for a human to confirm). See the [device verification example](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/tree/master/examples#device-verification).

### Registering a User

This module includes a node to register users using the Synapse secret registration endpoint. It returns both an `access_token` and a `device_id`, perfect for setting up the bot.

[Guide on registering a user via the web browser](https://skylar.tech/matrix-chat-bot-module-for-node-red/)

[Guide on registering using shared secret registration](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/tree/master/examples#readme) (for server owners)

### Other Packages

- [node-red-contrib-gamedig](https://www.npmjs.com/package/node-red-contrib-gamedig) - Query game servers from Node-RED.

### Contributing

We welcome all contributions! Please submit a pull request if you add a feature so the whole community can benefit.

**Sharing is caring!**
