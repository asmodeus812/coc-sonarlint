import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { diffPrepass } from "../../src/views/diffPrepass";
import { bundledSheets, describeView, VIEW_KINDS } from "../../src/views/kinds";
import { SONAR_LANGUAGES } from "../../src/views/languages";

test("sheet lists match upstream", () => {
    assert.deepEqual(VIEW_KINDS.rule.sheets, ["theme.css", "rule.css", "hotspot.css", "vs.css", "terminal.css"]);
    assert.deepEqual(VIEW_KINDS.hotspot.sheets, ["rule.css", "hotspot.css", "vs.css", "terminal.css"]);
    assert.deepEqual(VIEW_KINDS.connection.sheets, ["theme.css"]);
    assert.deepEqual(VIEW_KINDS.connectionSetup.sheets, ["theme.css", "connectionsetup.css"]);
});

test("bundledSheets resolves every kind's sheets once, frozen, under the extension path", () => {
    const bundled = bundledSheets("/ext");
    assert.deepEqual(bundled.hotspot, ["/ext/styles/rule.css", "/ext/styles/hotspot.css", "/ext/styles/vs.css", "/ext/styles/terminal.css"]);
    assert.deepEqual(bundled.connectionSetup, ["/ext/styles/theme.css", "/ext/styles/connectionsetup.css"]);
    assert.ok(Object.isFrozen(bundled) && Object.isFrozen(bundled.rule));
    const real = bundledSheets(process.cwd());
    for (const sheet of Object.values(real).flat()) {
        assert.ok(fs.existsSync(sheet), sheet);
    }
    assert.equal(real.rule[1], path.join(process.cwd(), "styles", "rule.css"));
});

test("the pre-pass and languages are the view kind's: rule and hotspot diff, connection views none", () => {
    assert.equal(VIEW_KINDS.rule.prepass, diffPrepass);
    assert.equal(VIEW_KINDS.hotspot.prepass, diffPrepass);
    assert.equal(VIEW_KINDS.rule.languages, SONAR_LANGUAGES);
    assert.equal(VIEW_KINDS.hotspot.languages, SONAR_LANGUAGES);
    for (const kind of ["connection", "connectionSetup"] as const) {
        assert.equal(VIEW_KINDS[kind].prepass, undefined, kind);
        assert.equal(VIEW_KINDS[kind].languages, undefined, kind);
    }
});

test("describeView: the kind's name, bundled then user sheets, pre-pass and languages; the view's html, title and lang", () => {
    const bundled = bundledSheets("/ext");
    const rule = describeView({ kind: "rule", html: "<p>x</p>", lang: "java", title: "T" }, bundled, ["/u/a.css"]);
    assert.deepEqual(rule, {
        name: "sonarlint://rule",
        title: "T",
        html: "<p>x</p>",
        stylesheets: [...bundled.rule, "/u/a.css"],
        prepass: diffPrepass,
        lang: "java",
        languages: SONAR_LANGUAGES
    });
    const connection = describeView({ kind: "connection", html: "", lang: "", title: "C" }, bundled, []);
    assert.equal(connection.name, "sonarlint://connection");
    assert.equal(connection.prepass, undefined);
    assert.deepEqual(connection.stylesheets, bundled.connection);
    assert.notEqual(connection.stylesheets, bundled.connection, "a copy: the static list is never handed out");
});
