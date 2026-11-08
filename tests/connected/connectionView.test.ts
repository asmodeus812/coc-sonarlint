import { test } from "node:test";
import * as assert from "node:assert/strict";
import { connectionRows, connectionView, maskToken } from "../../src/connected/connectionView";

test("SonarQube Server connection: table rows in order, values escaped, token masked", () => {
    const view = connectionView({
        status: "ok",
        connection: {
            connectionId: "my<conn>",
            serverUrl: "https://sq.example.com/?a=1&b=2",
            token: "squ_0123456789abcd",
            projectKey: "proj\"key",
            folderUri: "file:///home/me/my%20project",
            isFromSharedConfiguration: true
        }
    });
    assert.equal(view.view, "connection");
    assert.equal(view.lang, "");
    assert.ok(view.html.startsWith("<h1>Connection Summary</h1>\n<hr>\n<table>\n<caption>Properties</caption>"));
    const labels = [...view.html.matchAll(/<tr><th>([^<]*)<\/th>/g)].map((m) => m[1]);
    assert.deepEqual(labels, ["Type", "Status", "Connection ID", "Server URL", "User Token", "Notifications", "Project Key", "Folder", "Shared Configuration"]);
    assert.ok(view.html.includes("<td>my&lt;conn&gt;</td>"));
    assert.ok(view.html.includes("<td>https://sq.example.com/?a=1&amp;b=2</td>"));
    assert.ok(view.html.includes("<td>proj&quot;key</td>"));
    assert.ok(view.html.includes("<td>my project (file:///home/me/my%20project)</td>"));
    assert.ok(!view.html.includes("squ_0123456789"));
    assert.ok(view.html.includes("abcd (18 chars)"));
});

test("SonarQube Cloud connection: organization and region rows, dashes for missing values", () => {
    const rows = connectionRows({ status: "", connection: { organizationKey: "org", disableNotifications: true } });
    assert.deepEqual(rows, [
        ["Type", "SonarQube Cloud"],
        ["Status", "—"],
        ["Connection ID", "—"],
        ["Organization Key", "org"],
        ["Region", "EU"],
        ["User Token", "—"],
        ["Notifications", "Off"],
        ["Shared Configuration", "No"]
    ]);
    assert.equal(maskToken("abcdef"), "••••cdef (6 chars)");
    assert.ok(connectionView({ status: "x", connection: {} }, { title: "<T>" }).html.startsWith("<h1>&lt;T&gt;</h1>"));
});
