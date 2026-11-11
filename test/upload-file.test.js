const assert = require("assert");
const { helper, runNode } = require("./helpers/run-node.js");

const CONFIG = { inputType: "msg", inputValue: "payload", fileNameType: "msg", fileNameValue: "filename", generateThumbnails: true };

describe("Upload File: errors", function() {
    this.timeout(30000);
    after(() => helper.unload());

    it("a failed upload goes to the error output and a Catch node once", async () => {
        const client = { uploadContent: async () => { throw new Error("M_TOO_LARGE"); } };
        const r = await runNode("matrix-upload-file", CONFIG, { payload: Buffer.from("hello"), filename: "a.txt" }, client);
        assert.ok(r.err, "no error output");
        assert.match(String(r.err.error), /M_TOO_LARGE/);
        assert.strictEqual(r.errors.length, 1);
    });

    it("an image that can't be read still uploads, with a warning instead of an error", async () => {
        const client = { uploadContent: async () => ({ content_uri: "mxc://x/y" }) };
        const r = await runNode("matrix-upload-file", CONFIG, { payload: Buffer.from("not really an image"), filename: "pic.png" }, client);
        const warnings = helper.log().args.filter((a) => a[0] && a[0].level === helper.log().WARN).map((a) => a[0].msg);
        assert.ok(r.ok, r.err && r.err.error);
        assert.strictEqual(r.errors.length, 0, r.errors.join("\n"));
        assert.strictEqual(r.ok.payload.url, "mxc://x/y");
        assert.ok(warnings.length >= 1, "expected a warning");
    });

    it("a missing file goes to the error output", async () => {
        const client = { uploadContent: async () => ({ content_uri: "mxc://x/y" }) };
        const r = await runNode("matrix-upload-file", CONFIG, { payload: "/nonexistent/file.png" }, client);
        assert.ok(r.err, "no error output");
        assert.strictEqual(r.errors.length, 1);
    });
});
