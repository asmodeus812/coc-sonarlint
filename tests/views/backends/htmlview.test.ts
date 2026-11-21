import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import type { ExtensionLookup } from "../../../src/views/backends/htmlview";
import type { HtmlViewApi, RenderOptions } from "../../../src/views/backends/htmlviewApi";

// coc.nvim is types only outside the editor: give the backend a stub for its runtime import
const cocStub = { workspace: {}, window: {}, extensions: {} };
const load = (Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = (request: string, ...rest: unknown[]): unknown => (request === "coc.nvim" ? cocStub : load(request, ...rest));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HtmlviewBackend, loadHtmlview } = require("../../../src/views/backends/htmlview") as typeof import("../../../src/views/backends/htmlview");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createBackend } = require("../../../src/views/backends/backend") as typeof import("../../../src/views/backends/backend");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SimpleBackend } = require("../../../src/views/backends/simple") as typeof import("../../../src/views/backends/simple");

type Fake = { isActive: boolean; exports?: unknown; activate(): Promise<unknown> };

/** A fake coc extension registry holding `ext` as `coc-htmlview` (or nothing). */
function registry(ext: Fake | undefined, asked: string[] = []): ExtensionLookup {
    return { getExtensionById: (id: string) => (asked.push(id), ext) };
}

function fakeApi(version: number = 1, calls: Array<{ html: string; options: RenderOptions }> = []): HtmlViewApi {
    return { version, render: async (html: string, options: RenderOptions) => (calls.push({ html, options }), {} as never) } as unknown as HtmlViewApi;
}

test("loadHtmlview uses the exports of an active coc-htmlview reporting version 1", async () => {
    const api = fakeApi();
    const asked: string[] = [];
    assert.equal(await loadHtmlview(registry({ isActive: true, exports: api, activate: async () => assert.fail("already active") }, asked)), api);
    assert.deepEqual(asked, ["coc-htmlview"]);
});

test("loadHtmlview activates an inactive coc-htmlview once and uses its result", async () => {
    const api = fakeApi();
    let activated = 0;
    const ext: Fake = { isActive: false, activate: async () => (activated++, api) };
    assert.equal(await loadHtmlview(registry(ext)), api);
    assert.equal(activated, 1);
});

test("loadHtmlview yields undefined when coc-htmlview is absent, of another version, malformed or fails to activate", async () => {
    assert.equal(await loadHtmlview(registry(undefined)), undefined);
    assert.equal(await loadHtmlview(registry({ isActive: true, exports: fakeApi(2), activate: async () => undefined })), undefined);
    assert.equal(await loadHtmlview(registry({ isActive: true, exports: { version: 1 }, activate: async () => undefined })), undefined);
    assert.equal(await loadHtmlview(registry({ isActive: true, exports: undefined, activate: async () => undefined })), undefined);
    assert.equal(await loadHtmlview(registry({ isActive: false, activate: async () => fakeApi(0) })), undefined);
    const failing: Fake = { isActive: false, activate: async () => Promise.reject(new Error("boom")) };
    assert.equal(await loadHtmlview(registry(failing)), undefined);
});

test("createBackend picks htmlview when its API is available, else the simple one", () => {
    assert.ok(createBackend(fakeApi()) instanceof HtmlviewBackend);
    assert.ok(createBackend(undefined) instanceof SimpleBackend);
});

test("HtmlviewBackend renders the description as given, in a reused buffer without mode or split command", async () => {
    const calls: Array<{ html: string; options: RenderOptions }> = [];
    const prepass = (html: string): string => html;
    await new HtmlviewBackend(fakeApi(1, calls)).show({
        name: "sonarlint://rule", title: "T", html: "<p>x</p>", stylesheets: ["/a.css", "/b.css"], prepass, lang: "java", languages: { web: "html" }
    });
    assert.deepEqual(calls, [{
        html: "<p>x</p>",
        options: { stylesheets: ["/a.css", "/b.css"], prepass, lang: "java", languages: { web: "html" }, view: { name: "sonarlint://rule", reuse: true, title: "T" } }
    }]);
});
