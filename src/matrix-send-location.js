// matrix-js-sdk's main entry does not re-export `makeLocationContent`, so we
// deep-import the content-helpers module.  The SDK has no `exports` field in
// its package.json (verified against v41) so subpath imports are stable.
const contentHelpersPromise = import("matrix-js-sdk/lib/content-helpers.js");

module.exports = function(RED) {
    const VALID_ASSET_TYPES = ["m.self", "m.pin"];

    function MatrixSendLocation(n) {
        RED.nodes.createNode(this, n);
        let node = this;

        this.name = n.name;
        this.server = RED.nodes.getNode(n.server);
        this.roomId = n.roomId;

        // Dynamic inputs: each has a `*Type` (msg | flow | global | str | num)
        // and a `*Value` (the property path or literal).  Defaults preserve the
        // documented per-message names so existing flows keep working.
        //
        // The default name is only used when the setting is missing (older
        // configs) or a msg property is left blank. An empty str/num literal
        // means "not provided"; it used to be replaced by the default *name*,
        // so e.g. the text "geo_uri" was sent as the geo URI and an empty
        // asset type failed as "assetType".
        function typedSetting(type, value, defaultValue) {
            type = type || "msg";
            if (value === undefined || value === null || (value === "" && type === "msg")) {
                value = defaultValue;
            }
            return { type: type, value: value };
        }
        const settings = {
            latitude:    typedSetting(n.latitudeType,    n.latitudeValue,    "latitude"),
            longitude:   typedSetting(n.longitudeType,   n.longitudeValue,   "longitude"),
            altitude:    typedSetting(n.altitudeType,    n.altitudeValue,    "altitude"),
            geoUri:      typedSetting(n.geoUriType,      n.geoUriValue,      "geo_uri"),
            description: typedSetting(n.descriptionType, n.descriptionValue, "description"),
            assetType:   typedSetting(n.assetTypeType,   n.assetTypeValue,   "assetType"),
            timestamp:   typedSetting(n.timestampType,   n.timestampValue,   "timestamp"),
            text:        typedSetting(n.textType,        n.textValue,        "payload"),
        };
        this.latitudeType     = settings.latitude.type;
        this.latitudeValue    = settings.latitude.value;
        this.longitudeType    = settings.longitude.type;
        this.longitudeValue   = settings.longitude.value;
        this.altitudeType     = settings.altitude.type;
        this.altitudeValue    = settings.altitude.value;
        this.geoUriType       = settings.geoUri.type;
        this.geoUriValue      = settings.geoUri.value;
        this.descriptionType  = settings.description.type;
        this.descriptionValue = settings.description.value;
        this.assetTypeType    = settings.assetType.type;
        this.assetTypeValue   = settings.assetType.value;
        this.timestampType    = settings.timestamp.type;
        this.timestampValue   = settings.timestamp.value;
        this.textType         = settings.text.type;
        this.textValue        = settings.text.value;

        if (!node.server) {
            node.warn("No configuration node");
            return;
        }
        node.server.register(node);

        node.status({ fill: "red", shape: "ring", text: "disconnected" });
        node.server.listen(node, "disconnected", function() {
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });
        node.server.listen(node, "connected", function() {
            node.status({ fill: "green", shape: "ring", text: "connected" });
        });

        /**
         * Resolve a typed-input pair to its runtime value.
         *  msg | flow | global - read the property path from that source.
         *  num                  - parse the configured literal as a number;
         *                         empty string => undefined.
         *  str                  - the configured literal; empty string => undefined.
         *  bool                 - "true" => true, anything else => false.
         *
         * Returning `undefined` from this signals "not provided", which is
         * how optional fields opt out.
         */
        function getToValue(msg, type, property) {
            if (type === "msg") {
                return RED.util.getMessageProperty(msg, property);
            }
            if (type === "flow" || type === "global") {
                try {
                    return RED.util.evaluateNodeProperty(property, type, node, msg);
                } catch (e) {
                    throw new Error("Invalid " + type + " value evaluation for '" + property + "'");
                }
            }
            if (property === "" || property === undefined || property === null) {
                return undefined;
            }
            if (type === "num") {
                const n = Number(property);
                return Number.isFinite(n) ? n : undefined;
            }
            if (type === "bool") {
                return property === "true";
            }
            // str / default
            return property;
        }

        function isEmpty(v) {
            return v === undefined || v === null || v === "";
        }

        node.on("input", async function(msg) {
            if (!node.server || !node.server.matrixClient) {
                msg.error = "No matrix server selected";
                node.error("No matrix server selected", msg);
                node.send([null, msg]);
                return;
            }
            if (!node.server.isConnected()) {
                msg.error = "Matrix server connection is currently closed";
                node.error("Matrix server connection is currently closed", msg);
                node.send([null, msg]);
                return;
            }

            msg.topic = node.roomId || msg.topic;
            if (!msg.topic) {
                msg.error = "Room must be specified in msg.topic or in configuration";
                node.error("Room must be specified in msg.topic or in configuration", msg);
                node.send([null, msg]);
                return;
            }

            // Resolve every typed input up-front so a single bad config or
            // flow/global lookup surfaces as one clear error.
            let rawLat, rawLng, rawAlt, rawGeoUri, description, assetType, rawTimestamp, text;
            try {
                rawLat       = getToValue(msg, node.latitudeType,     node.latitudeValue);
                rawLng       = getToValue(msg, node.longitudeType,    node.longitudeValue);
                rawAlt       = getToValue(msg, node.altitudeType,     node.altitudeValue);
                rawGeoUri    = getToValue(msg, node.geoUriType,       node.geoUriValue);
                description  = getToValue(msg, node.descriptionType,  node.descriptionValue);
                assetType    = getToValue(msg, node.assetTypeType,    node.assetTypeValue);
                rawTimestamp = getToValue(msg, node.timestampType,    node.timestampValue);
                text         = getToValue(msg, node.textType,         node.textValue);
            } catch (e) {
                node.error(e.message, msg);
                node.send([null, msg]);
                return;
            }

            // Build the geo URI: prefer an explicit geo_uri when supplied;
            // otherwise build geo:<lat>,<lng>[,<alt>] from numeric inputs.
            let geoUri = isEmpty(rawGeoUri) ? null : String(rawGeoUri);
            if (!geoUri) {
                const lat = parseFloat(rawLat);
                const lng = parseFloat(rawLng);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                    msg.error = "Latitude and longitude (numbers) - or a geo_uri - are required";
                    node.error("Latitude and longitude (numbers) - or a geo_uri - are required", msg);
                    node.send([null, msg]);
                    return;
                }
                if (lat < -90 || lat > 90) {
                    node.error("Latitude (" + lat + ") is out of range; must be between -90 and 90", msg);
                    node.send([null, msg]);
                    return;
                }
                if (lng < -180 || lng > 180) {
                    node.error("Longitude (" + lng + ") is out of range; must be between -180 and 180", msg);
                    node.send([null, msg]);
                    return;
                }
                geoUri = "geo:" + lat + "," + lng;
                if (!isEmpty(rawAlt)) {
                    const alt = parseFloat(rawAlt);
                    if (!Number.isFinite(alt)) {
                        msg.error = "Altitude must be a number when provided";
                        node.error("Altitude must be a number when provided", msg);
                        node.send([null, msg]);
                        return;
                    }
                    geoUri = "geo:" + lat + "," + lng + "," + alt;
                }
            }

            // Asset type defaults to m.self if the resolved value is empty.
            if (isEmpty(assetType)) {
                assetType = "m.self";
            }
            if (VALID_ASSET_TYPES.indexOf(assetType) === -1) {
                node.error('Invalid asset type "' + assetType + '"; must be "m.self" or "m.pin"', msg);
                node.send([null, msg]);
                return;
            }

            // Timestamp the location was correct, in ms since the UNIX epoch.
            let timestamp = Date.now();
            if (!isEmpty(rawTimestamp)) {
                const ts = Number(rawTimestamp);
                if (Number.isFinite(ts)) {
                    timestamp = ts;
                }
            }

            // makeLocationContent uses `undefined` to mean "generate a default".
            const cleanDescription = isEmpty(description) ? undefined : String(description);
            const cleanText        = isEmpty(text)        ? undefined : String(text);

            try {
                const { makeLocationContent } = await contentHelpersPromise;
                const content = makeLocationContent(cleanText, geoUri, timestamp, cleanDescription, assetType);
                const response = await node.server.matrixClient.sendMessage(msg.topic, content);
                msg.eventId = response.event_id;
                msg.payload = content;
                node.send([msg, null]);
            } catch (e) {
                node.error("Error sending location: " + e, msg);
                msg.error = e;
                node.send([null, msg]);
            }
        });

        node.on("close", function() {
            node.server.deregister(node);
        });
    }

    RED.nodes.registerType("matrix-send-location", MatrixSendLocation);
};
