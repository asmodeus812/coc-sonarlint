import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import type { DescriptionRenderer, ExtensionLookup } from "../../src/util/views";
import type { HtmlViewApi, RenderOptions } from "../../src/util/htmlviewApi";
import { renderSimple } from "../../src/util/simpleRender";

// coc.nvim is types only outside the editor: give views.ts a stub for its runtime import (workspace and window are set per test)
const cocStub = { workspace: {} as Record<string, unknown>, window: {} as Record<string, unknown>, extensions: {} as Record<string, unknown> };
const load = (Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = (request: string, ...rest: unknown[]): unknown => (request === "coc.nvim" ? cocStub : load(request, ...rest));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRenderer, HtmlviewRenderer, loadHtmlview, SimpleRenderer, SonarViews } = require("../../src/util/views") as typeof import("./views");

const input = { html: "<h2>Why</h2><p>text</p>", lang: "java", view: "rule", title: "t" } as const;

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

test("createRenderer picks htmlview when its API is available, else the simple one", () => {
    assert.ok(createRenderer("/ext", fakeApi()) instanceof HtmlviewRenderer);
    assert.ok(createRenderer("/ext", undefined) instanceof SimpleRenderer);
});

test("both adapters implement DescriptionRenderer", () => {
    const adapters: DescriptionRenderer[] = [new HtmlviewRenderer(fakeApi(), "/ext"), new SimpleRenderer()];
    for (const a of adapters) {
        assert.equal(typeof a.show, "function");
    }
    // the simple adapter's pure part, on the same input
    assert.deepEqual(renderSimple(input.html, { width: 40 }).lines, ["## Why", "", "text"]);
});

test("HtmlviewRenderer passes bundled then user sheets, the pre-pass, languages and a view without mode or split command", async () => {
    Object.assign(cocStub.workspace, {
        root: "/ws",
        expand: (s: string): string => s.replace("~", "/home/u"),
        getConfiguration: (section: string) => ({ get: (key: string, dflt: unknown) => (section === "sonarlint.view" && key === "stylesheets" ? ["~/a.css", "rel.css", "", 3] : dflt) })
    });
    const calls: Array<{ html: string; options: RenderOptions }> = [];
    await new HtmlviewRenderer(fakeApi(1, calls), "/ext").show(input, { name: "sonarlint://rule", title: "T" });
    assert.equal(calls.length, 1);
    const { html, options } = calls[0];
    assert.equal(html, input.html);
    const sheets = options.stylesheets as string[];
    assert.deepEqual(sheets.slice(-2), ["/home/u/a.css", "/ws/rel.css"]);
    assert.ok(sheets.length > 2 && sheets.slice(0, -2).every((s) => s.startsWith("/ext/styles/")), sheets.join(","));
    assert.equal(typeof options.prepass, "function");
    assert.equal(options.lang, "java");
    assert.equal((options.languages as Record<string, unknown>).web, "html");
    assert.deepEqual(options.view, { name: "sonarlint://rule", reuse: true, title: "T" });
});

test("SonarViews delegates to the renderer it is given", async () => {
    const calls: string[] = [];
    const fake: DescriptionRenderer = { show: async (_i, o) => void calls.push(o.name) };
    await new SonarViews("/ext", fake).show(input, { name: "sonarlint://x" });
    assert.deepEqual(calls, ["sonarlint://x"]);
});

test("SonarViews looks coc-htmlview up on the first show only, then falls back when it is not there", async () => {
    let lookups = 0;
    const shown: string[] = [];
    Object.assign(cocStub.extensions, { getExtensionById: () => (lookups++, undefined) });
    Object.assign(cocStub.window, { showErrorMessage: async (m: string) => void shown.push(m), showWarningMessage: async () => undefined });
    Object.assign(cocStub.workspace, { nvim: undefined });
    const views = new SonarViews("/ext");
    assert.equal(lookups, 0, "lazy: nothing at construction");
    // the simple renderer needs a real nvim, so the first show reports an error: what matters is that the lookup happened once
    await views.show(input, { name: "sonarlint://x" });
    await views.show(input, { name: "sonarlint://x" });
    assert.equal(lookups, 1);
    assert.equal(shown.length, 2);
});
