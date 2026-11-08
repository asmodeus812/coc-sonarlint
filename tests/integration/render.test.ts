// End to end without coc: adapters → htmlview render (parse, style, layout, highlight) → view on a fake nvim.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Neovim } from "coc.nvim";
import type { ShowRuleDescriptionParams } from "../../src/lsp/protocol";
import { loadFixture } from "../fixtures";
import { displayWidth } from "@htmlview/common";
import { renderOn } from "@htmlview/render";
import { diffPrepass } from "../../src/rules/diffPrepass";
import { localHotspotView } from "../../src/hotspot/hotspotView";
import { sheetPaths, ViewInput } from "../../src/rules/markup";
import { ruleView } from "../../src/rules/ruleView";

type Call = { name: string; args: unknown[] };

/** Records the view's Lua calls; answers `open`/`state` with a window of `width` cells. */
class FakeNvim extends EventEmitter {
    calls: Call[] = [];
    width = 80;
    async createNamespace(name: string): Promise<number> {
        return name === "htmlview" ? 1 : 2;
    }
    async lua(_code: string, args: unknown[]): Promise<unknown> {
        const fn = args[2] as string;
        this.calls.push({ name: fn, args: args[3] as unknown[] });
        const state = { winid: 1000, width: this.width, background: "dark" };
        return fn === "open" ? { bufnr: 7, ...state } : fn === "state" ? state : true;
    }
    async call(name: string): Promise<unknown> {
        return name === "has" ? 1 : 0;
    }
    async eval(): Promise<unknown> {
        return "dark";
    }
    async command(): Promise<void> {}
    fire(ev: Record<string, unknown>): void {
        this.emit("notification", "CocAutocmd", ["HtmlviewEvent", ev]);
    }
    /** Lines and groups of every `update` call. */
    updates(): Array<{ lines: string[]; groups: Array<{ name: string }> }> {
        return this.calls.filter((c) => c.name === "update").map((c) => ({ lines: c.args[3] as string[], groups: c.args[4] as Array<{ name: string }> }));
    }
    /** The decorations of every `update` call. */
    decors(): Array<{ virt: Array<[number, number, string, Array<[string, string[]]>, number, number]> }> {
        return this.calls.filter((c) => c.name === "update").map((c) => c.args[6] as never);
    }
    token(): string {
        return (this.calls.find((c) => c.name === "open")?.args[0] as Record<string, unknown>).token as string;
    }
}

/** Byte column of `needle` in `line` (link columns are bytes). */
const byteCol = (line: string, needle: string): number => Buffer.byteLength(line.slice(0, line.indexOf(needle)));
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

function contextualRule(): ShowRuleDescriptionParams {
    return {
        key: "java:S2077",
        name: "Formatting SQL queries is security-sensitive",
        htmlDescription: "",
        htmlDescriptionTabs: [
            { title: "Why is this an issue?", hasContextualInformation: false, ruleDescriptionTabNonContextual: { htmlContent: loadFixture("rule-sections") } },
            {
                title: "How can I fix it?",
                hasContextualInformation: true,
                defaultContextKey: "jdbc",
                ruleDescriptionTabContextual: [
                    { htmlContent: loadFixture("code-diff-single-pair"), contextKey: "jdbc", displayName: "JDBC" },
                    { htmlContent: "<p>Use the <code>JPA</code> criteria API.</p>", contextKey: "jpa", displayName: "JPA" }
                ]
            }
        ],
        severityDetails: { severity: "MAJOR", type: "SECURITY_HOTSPOT" },
        languageKey: "java",
        isTaint: false
    };
}

async function show(nvim: FakeNvim, input: ViewInput) {
    return renderOn(nvim as unknown as Neovim, input.html, {
        stylesheets: sheetPaths(input.view, process.cwd()),
        prepass: diffPrepass,
        lang: input.lang,
        view: { mode: "split", name: `sonarlint://${input.view}`, reuse: true }
    });
}

function assertDecorated(decor: { virt: Array<[number, number, string, Array<[string, string[]]>, number, number]> }): void {
    const target = decor.virt.find((v) => v[3][0][0].startsWith(" 🔗 "));
    assert.ok(target !== undefined && target[3][0][1].includes("HtmlViewHostLinkUrl"), "a link-target tuple");
    assert.ok(decor.virt.some((v) => v[2] === "overlay"), "a list marker overlay");
}

function assertSane(update: { lines: string[]; groups: Array<{ name: string }> }, width: number): void {
    assert.ok(update.lines.length > 5);
    assert.ok(update.lines.every((l) => !l.includes("\t") && !l.includes("\n")));
    assert.ok(update.groups.some((g) => g.name.startsWith("HtmlView")));
    // prose wraps at the width; only code (never wrapped) may exceed it
    assert.ok(update.lines.filter((l) => displayWidth(l) > width).length < update.lines.length / 4);
}

test("render: rule view with tabs, contexts and a code diff; context switch and resize relayout", async () => {
    const nvim = new FakeNvim();
    const view = await show(nvim, ruleView(contextualRule()));
    assert.equal(view.bufnr, 7);
    const first = nvim.updates()[0];
    assertSane(first, 80);
    const text = first.lines.join("\n");
    assert.ok(text.includes("Formatting SQL queries"));
    assert.ok(text.includes("How to fix it in JDBC") && text.includes("How can I fix it?"), "the checked tab shows, the other label is in the bar");
    assertDecorated(nvim.decors()[0]);

    // the second tab label is a context link: <CR> on it toggles the tab radio (interact.activate, restyle)
    const label = first.lines.findIndex((l) => l.includes("How can I fix it?"));
    nvim.fire({ token: nvim.token(), kind: "key", action: "follow", line: label, col: byteCol(first.lines[label], "How") });
    await tick();
    const switched = nvim.updates().at(-1)!;
    assert.equal(nvim.updates().length, 2);
    assert.ok(!switched.lines.join("\n").includes("injection)"), "the first tab is hidden after the toggle");
    assert.ok(switched.lines.join("\n").includes("Noncompliant"), "the second tab is shown");

    nvim.width = 40;
    nvim.fire({ token: nvim.token(), kind: "resize", winid: 1000, width: 40, background: "dark" });
    await tick();
    assertSane(nvim.updates().at(-1)!, 40);
    await view.close();
});

test("render: the context label bar shows, and <CR> and ]c toggle contexts", async () => {
    const nvim = new FakeNvim();
    const input = ruleView(contextualRule());
    const secondTab = input.html.replace(' id="tab-0" checked="checked"', ' id="tab-0"').replace(' id="tab-1"', ' id="tab-1" checked="checked"');
    const view = await renderOn(nvim as unknown as Neovim, secondTab, {
        stylesheets: sheetPaths("rule", process.cwd()),
        prepass: diffPrepass,
        lang: input.lang,
        view: { mode: "split", name: "sonarlint://rule", reuse: true }
    });
    const first = nvim.updates()[0].lines;
    const bar = first.findIndex((l) => l.includes("JDBC"));
    assert.ok(bar >= 0 && first[bar].includes("JPA"), "the labels share one bar");
    assert.ok(first.findIndex((l) => l.includes("How can I fix it in JDBC")) > bar, "the bar is above the context content");
    assert.ok(!first.join("\n").includes("criteria API"));
    nvim.fire({ token: nvim.token(), kind: "key", action: "follow", line: bar, col: byteCol(first[bar], "JPA") });
    await tick();
    const viaEnter = nvim.updates().at(-1)!.lines.join("\n");
    assert.ok(viaEnter.includes("criteria API") && !viaEnter.includes("jdbc"), "<CR> on a context label switches the context");
    nvim.fire({ token: nvim.token(), kind: "key", action: "prevContext", line: bar, col: 0 });
    await tick();
    assert.ok(!nvim.updates().at(-1)!.lines.join("\n").includes("criteria API"), "[c goes back to the first context");
    nvim.fire({ token: nvim.token(), kind: "key", action: "nextContext", line: bar, col: 0 });
    await tick();
    assert.ok(nvim.updates().at(-1)!.lines.join("\n").includes("criteria API"), "]c moves to the next context");
    await view.close();
});

test("render: local hotspot view and raw fixtures render through the per-view sheets", async () => {
    const nvim = new FakeNvim();
    const hotspot = localHotspotView(contextualRule(), { message: "Make sure using a dynamically formatted SQL query is safe here.", probability: "High", status: "To review" });
    await show(nvim, hotspot);
    const lines = nvim.updates()[0].lines.join("\n");
    assert.ok(lines.includes("Review priority") && lines.toLowerCase().includes("high"));
    for (const name of ["rule-tabs-contexts", "hotspot"]) {
        const other = new FakeNvim();
        await show(other, { html: loadFixture(name), lang: "java", view: "rule", title: name });
        assertSane(other.updates()[0], 80);
    }
});

test("render: the demo document renders through the engine with decorations", async () => {
    const nvim = new FakeNvim();
    const view = await show(nvim, { html: loadFixture("demo"), lang: "java", view: "rule", title: "demo" });
    assertSane(nvim.updates()[0], 80);
    assertDecorated(nvim.decors()[0]);
    nvim.width = 40;
    nvim.fire({ token: nvim.token(), kind: "resize", winid: 1000, width: 40, background: "dark" });
    await tick();
    assert.equal(nvim.updates().length, 2);
    await view.close();
});
