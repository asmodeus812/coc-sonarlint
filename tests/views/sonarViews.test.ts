import assert from "node:assert/strict";
import Module from "node:module";
import * as path from "node:path";
import { test } from "node:test";
import type { ViewBackend, ViewDescription } from "../../src/views/backends/backend";
import type { SonarView } from "../../src/views/kinds";

// coc.nvim is types only outside the editor: give the views a stub for its runtime import (set per test)
const cocStub = { workspace: {} as Record<string, unknown>, window: {} as Record<string, unknown>, extensions: {} as Record<string, unknown> };
const load = (Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = (request: string, ...rest: unknown[]): unknown => (request === "coc.nvim" ? cocStub : load(request, ...rest));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveSheetPath, SonarViews, userSheetPaths } = require("../../src/views/sonarViews") as typeof import("../../src/views/sonarViews");

const view: SonarView = { kind: "rule", html: "<h2>Why</h2><p>text</p>", lang: "java", title: "t" };

/** The `sonarlint.view.stylesheets` setting as `sheets`. */
function setSheets(sheets: unknown): void {
    Object.assign(cocStub.workspace, {
        root: "/ws",
        expand: (s: string): string => s.replace("~", "/home/u"),
        getConfiguration: (section: string) => ({ get: (key: string, dflt: unknown) => (section === "sonarlint.view" && key === "stylesheets" ? sheets : dflt) })
    });
}

test("resolveSheetPath resolves relative paths against the root", () => {
    assert.equal(resolveSheetPath("a/b.css", "/ws"), path.resolve("/ws", "a/b.css"));
    assert.equal(resolveSheetPath("/abs/b.css", "/ws"), "/abs/b.css");
    assert.equal(resolveSheetPath("b.css", ""), "b.css");
});

test("userSheetPaths expands and resolves the setting's strings, skipping the rest", () => {
    setSheets(["~/a.css", "rel.css", "", 3]);
    assert.deepEqual(userSheetPaths(), ["/home/u/a.css", "/ws/rel.css"]);
    setSheets("nope");
    assert.deepEqual(userSheetPaths(), []);
});

test("SonarViews hands the backend the described view, reading the user sheets on every show", async () => {
    const shown: ViewDescription[] = [];
    const backend: ViewBackend = { show: async (d: ViewDescription) => void shown.push(d) };
    const views = new SonarViews("/ext", backend);
    setSheets(["~/a.css"]);
    await views.show(view);
    setSheets(["~/b.css"]);
    await views.show({ kind: "connection", html: "<h1>c</h1>", lang: "", title: "C" });
    assert.equal(shown[0].name, "sonarlint://rule");
    assert.deepEqual(shown[0].stylesheets, ["theme.css", "rule.css", "hotspot.css", "vs.css", "terminal.css"].map((s) => `/ext/styles/${s}`).concat("/home/u/a.css"));
    assert.equal(typeof shown[0].prepass, "function");
    assert.equal(shown[1].name, "sonarlint://connection");
    assert.deepEqual(shown[1].stylesheets, ["/ext/styles/theme.css", "/home/u/b.css"]);
    assert.equal(shown[1].prepass, undefined);
});

test("SonarViews reports a failing backend once per show and never throws", async () => {
    const shown: string[] = [];
    Object.assign(cocStub.window, { showErrorMessage: async (m: string) => void shown.push(m) });
    setSheets([]);
    await new SonarViews("/ext", { show: async () => Promise.reject(new Error("boom")) }).show(view);
    assert.deepEqual(shown, ["SonarLint: cannot show sonarlint://rule: boom"]);
});

test("SonarViews looks coc-htmlview up on the first show only, then falls back when it is not there", async () => {
    let lookups = 0;
    const shown: string[] = [];
    Object.assign(cocStub.extensions, { getExtensionById: () => (lookups++, undefined) });
    Object.assign(cocStub.window, { showErrorMessage: async (m: string) => void shown.push(m), showWarningMessage: async () => undefined });
    setSheets([]);
    const views = new SonarViews("/ext");
    assert.equal(lookups, 0, "lazy: nothing at construction");
    // the simple backend needs a real nvim, so each show reports an error: what matters is that the lookup happened once
    await views.show(view);
    await views.show(view);
    assert.equal(lookups, 1);
    assert.equal(shown.length, 2);
});
