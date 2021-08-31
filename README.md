# node-red-contrib-matrix-chat
Matrix chat server client for [Node-RED](https://nodered.org/)

***Currently we are in beta. We ask that you open any issues you have on our repository to help us reach a stable well tested version. Things may change & break before our first release so check changelog before updating.***

### Features

The following is supported from this package:

- End-to-end encryption supported
- Receive events from a room (messages, reactions, images, and files) whether encrypted or not
- Send Images/Files (sending files to e2ee room doesn't currently encrypt them yet)
- Decrypt files in e2ee rooms
- Send HTML/Plain Text Message/Notice
- React to messages
- Register user's on closed registration Synapse servers using `registration_shared_secret` (Admin Only)
- List out users on a Synapse server (Admin Only)
- Get WhoIs info for a Synapse user (Admin Only)
- Add/Edit Synapse users using the v2 API (requires a pre-existing admin account)
- Deactivate users on Synapse servers (Admin Only)
- Get a user list from a room
- Kick user from room
- Ban user from room
- Join a room
- Create a room
- Invite to a room
- Synapse admin API to force add user to room (requires bot to be in same room already)


Therefore, you can easily build a bot, chat relay, or administrate your Matrix server from within [Node-RED](https://nodered.org/).

### Usage
We have examples! [Check them out](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/tree/master/examples#readme)

### Installing

You can either install from within Node-RED by searching for `node-red-contrib-matrix-chat` or run this from within your Node-RED directory:
```bash
npm install node-red-contrib-matrix-chat
```

### End-to-End Encryption Notes
Currently this module has no way of getting encryption keys from other devices on the same account. Therefore it is recommended you use the bot exclusively with Node-RED after it's creation. Failure to do so will lead to your bot being unable to receive messages from e2ee rooms it joined from another client. Shared secret registration makes this super easy since it returns a token and device ID.

This module stores a folder in your Node-RED directory called `matrix-local-storage` and is it vital that you periodically back this up if you are using e2ee. This is where the client stores all the keys necessary to decrypt messages and if lost you will lose access to e2e rooms. If you move your client to another NR install make sure to migrate this folder as well (and do not let both the old and new client run at same time).

Want to contribute? Any help on getting the last pieces of e2ee figured out would be greatly appreciated :)

### Generate user
You will need a user to use this module. Luckily this module comes with a node that allows you to register users to a homeserver using the secret registration endpoint. This is perfect because it returns an `access_token` as well as a `device_id` which is exactly what we need.

[Click here](https://github.com/Skylar-Tech/node-red-contrib-matrix-chat/tree/master/examples#readme) to see how to generate a user using secret registration



### Other Packages

- [node-red-contrib-gamedig](https://www.npmjs.com/package/node-red-contrib-gamedig) - Query game servers from Node-RED!

### Contributing
All contributions are welcome! If you do add a feature please do a pull request so that everyone benefits :)

Sharing is caring!