# node-red-contrib-matrix-chat
[Matrix](https://matrix.org/) chat client for [Node-RED](https://nodered.org/), with full end-to-end encryption support.

Please report any issues in our [issue tracker](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/issues). Breaking changes between releases are listed in the [release notes](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/releases); check them before upgrading.

Join our public Matrix room for help: [#node-red-contrib-matrix-chat:skylar.tech](https://app.element.io/#/room/#node-red-contrib-matrix-chat:skylar.tech)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/B0B51BM7C)

### Features

Supported functionality in this package includes:

- **End-to-end encryption (E2EE)**: send and receive encrypted messages (see the [encryption notes](#end-to-end-encryption-notes))
- **Cross-signing & secure backup**: interactive setup from the server config node so the bot's own device shows as verified
- **Device verification**: interactive SAS (emoji) verification, either from the server config node or with the `matrix-verification` flow nodes
- **Session management**: review, verify, rename, or remove the account's sessions from the server config node (Element-style)
- **Receive events** from rooms (encrypted or unencrypted): messages, reactions, emotes, notices, stickers, images, video, audio, locations, files
- **Fetch/modify room state**: Update room settings
- **Paginate room history**
- **Send files** to rooms, encrypted or unencrypted
- **Send & modify messages** (plain text, Markdown, and HTML formats)
- **Send location messages**: produce `m.location` events that match Element's *"Share my location"* wire format
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
- **Storage:** E2EE state is saved in a folder called `matrix-client-storage` within your Node-RED directory. Each account's Rust crypto store is persisted there as `rust-crypto-store.v8` (snapshotted on shutdown and every 5 minutes). Setting up secure backup (below) lets you recover the account's keys even if this folder is lost.
- **Cross-signing & secure backup (strongly recommended):** open the server config node and use the **Set up secure backup & cross-signing** button. It lets you unlock an existing secure backup with its recovery key, or create a fresh one; once done, the bot's own device is cross-signed and shows as verified to others. **Save the recovery key somewhere safe.** It is shown only once, and is the only way to restore the account's encryption keys if the crypto store is ever lost.
- **Device verification:** there are two ways to verify devices:
    - From the server config node, the **Pending verification requests** button opens a list of incoming requests and lets you complete the SAS (emoji) check interactively, no flow required.
    - Or build your own flow: the `matrix-verification` node emits verification requests and phase changes, and `matrix-verification-action` accepts, starts, confirms, or cancels them (e.g. emailing the SAS emoji for a human to confirm). See the [device verification example](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/tree/master/examples#device-verification).

### Registering a User

This module includes a node to register users using the Synapse secret registration endpoint. It returns both an `access_token` and a `device_id`, perfect for setting up the bot.

[Guide on registering a user via the web browser](https://skylar.tech/matrix-chat-bot-module-for-node-red/)

[Guide on registering using shared secret registration](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/tree/master/examples#readme) (for server owners)

### Other Packages

- [node-red-contrib-gamedig](https://www.npmjs.com/package/node-red-contrib-gamedig) - Query game servers from Node-RED.

### Contributing

We welcome all contributions! Please submit a pull request if you add a feature so the whole community can benefit.

**Sharing is caring!**
