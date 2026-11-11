// Stand-in for matrix-server-config. Its matrixClient is whatever the test
// put in global.__matrixClient (a stub, or a real client in the live tests).
module.exports = function(RED) {
    function FakeServer(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.users = {};
        node.connected = true;
        node.initialSyncLimit = 25;
        node.register = (c) => { node.users[c.id] = c; };
        node.deregister = (c) => { delete node.users[c.id]; };
        node.listen = (c, ev, fn) => node.on(ev, fn);
        node.isConnected = () => true;
        node.matrixClient = global.__matrixClient;
    }
    RED.nodes.registerType("matrix-server-config", FakeServer);
};
