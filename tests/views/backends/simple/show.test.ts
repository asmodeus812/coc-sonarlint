import assert from "node:assert/strict";
import { test } from "node:test";
import { KEYS, SimpleView, ViewHost } from "../../../../src/views/backends/simple/show";

interface Buf { bufnr: number; name: string; lines: string[]; opts: Record<string, unknown>; hl: unknown[] }

/** A small model of the editor: buffers, windows, the cursor, and a log of calls. */
class FakeNvim {
    bufs: Buf[] = [];
    wins = new Map<number, { bufnr: number; width: number; opts: Record<string, unknown> }>();
    current = 1000;
    cursor: [number, number] = [0, 0];
    columns = 120;
    nvim = true;
    tabstop = 8;
    commands: string[] = [];
    calls: Array<[string, unknown[]]> = [];
    floats: unknown[] = [];

    constructor() {
        this.wins.set(1000, { bufnr: 1, width: 120, opts: {} });
        this.bufs.push({ bufnr: 1, name: "", lines: [""], opts: {}, hl: [] });
    }

    buf(n: number): Buf {
        return this.bufs.find((b) => b.bufnr === n) as Buf;
    }

    winOf(bufnr: number): number {
        return [...this.wins.entries()].find(([, w]) => w.bufnr === bufnr)?.[0] ?? -1;
    }

    async command(cmd: string): Promise<void> {
        this.commands.push(cmd);
        const m = /botright vsplit \| buffer (\d+)/.exec(cmd);
        if (m) {
            const id = 2000 + this.wins.size;
            this.wins.set(id, { bufnr: Number(m[1]), width: 60, opts: {} });
            this.current = id;
        }
    }

    async eval(expr: string): Promise<unknown> {
        let out: unknown;
        const name = /b\.name ==# '([^']*(?:''[^']*)*)'/.exec(expr);
        const info = /getwininfo\((\d+)\)/.exec(expr);
        if (name) {
            out = this.bufs.find((b) => b.name === name[1].replace(/''/g, "'"))?.bufnr ?? -1;
        } else if (expr.startsWith("has('nvim')")) {
            out = this.nvim ? 1 : 0;
        } else if (expr.startsWith("[&columns")) {
            out = [this.columns, 40, this.tabstop];
        } else if (info) {
            out = this.wins.get(Number(info[1]))?.width;
        } else if (expr.startsWith("[line('.')")) {
            out = this.cursor;
        }
        return out;
    }

    async call(fn: string, args: unknown[] = []): Promise<unknown> {
        this.calls.push([fn, args]);
        let out: unknown = 0;
        const b = typeof args[0] === "number" ? this.bufs.find((x) => x.bufnr === args[0]) : undefined;
        if (fn === "bufadd") {
            const bufnr = Math.max(...this.bufs.map((x) => x.bufnr)) + 1;
            this.bufs.push({ bufnr, name: args[0] as string, lines: [""], opts: {}, hl: [] });
            out = bufnr;
        } else if (fn === "setbufvar" && b) {
            b.opts[args[1] as string] = args[2];
        } else if (fn === "setbufline" && b) {
            b.lines = args[2] as string[];
        } else if (fn === "deletebufline" && b) {
            b.lines = [""];
        } else if (fn === "coc#highlight#set" && b) {
            b.hl = args[2] as unknown[];
        } else if (fn === "bufwinid") {
            out = this.winOf(args[0] as number);
        } else if (fn === "win_getid") {
            out = this.current;
        } else if (fn === "setwinvar") {
            const w = this.wins.get(args[0] as number);
            if (w) w.opts[args[1] as string] = args[2];
        } else if (fn === "nvim_open_win") {
            const id = 3000 + this.wins.size;
            this.floats.push(args[2]);
            this.wins.set(id, { bufnr: args[0] as number, width: (args[2] as { width: number }).width, opts: {} });
            this.current = id;
            out = id;
        } else if (fn === "win_execute") {
            const m = /cursor\((\d+), (\d+)\)/.exec(args[1] as string);
            if (m) this.cursor = [Number(m[1]) - 1, Number(m[2]) - 1];
        }
        return out;
    }
}

function setup(nvim = new FakeNvim()) {
    const keys = new Map<string, () => unknown>();
    const autocmds: Array<{ event: string; buffer?: number; callback: (...a: unknown[]) => unknown }> = [];
    const opened: string[] = [];
    const logs: string[] = [];
    const host: ViewHost = {
        nvim,
        registerLocalKeymap: (bufnr, _mode, lhs, fn) => {
            keys.set(`${bufnr}:${lhs}`, fn);
            return { dispose: () => keys.delete(`${bufnr}:${lhs}`) };
        },
        registerAutocmd: (a) => {
            autocmds.push(a);
            return { dispose: () => undefined };
        },
        openResource: async (uri) => {
            opened.push(uri);
        },
        log: (m) => logs.push(m),
    };
    const view = new SimpleView(host);
    const press = async (bufnr: number, lhs: string) => {
        await keys.get(`${bufnr}:${lhs}`)?.();
    };
    return { nvim, view, keys, autocmds, opened, logs, press };
}

const TABS = '<input type="radio" name="t" id="a" checked><label for="a">One</label><section><p>first panel</p></section>' +
    '<input type="radio" name="t" id="b"><label for="b">Two</label><section><p>second panel</p></section>' +
    '<input type="radio" name="t" id="c"><label for="c">Three</label><section><p>third panel</p></section>';

test("scratch buffer: options, float with title, highlights, keys", async () => {
    const { nvim, view, keys, autocmds } = setup();
    await view.show({ name: "sonarlint://rule", title: "Rule S1", html: "<h2>Why</h2><p>text</p>" });
    const b = nvim.bufs.find((x) => x.name === "sonarlint://rule") as Buf;
    assert.ok(b);
    assert.equal(b.opts["&buftype"], "nofile");
    assert.equal(b.opts["&bufhidden"], "hide");
    assert.equal(b.opts["&swapfile"], 0);
    assert.equal(b.opts["&modifiable"], 0);
    assert.deepEqual(b.lines, ["◆ Why", "", "text"]);
    assert.ok(b.hl.some((h) => (h as unknown[])[0] === "Title" && (h as unknown[])[1] === 0));
    const w = nvim.wins.get(nvim.winOf(b.bufnr));
    assert.equal(w?.opts["&wrap"], 0);
    assert.equal((nvim.floats[0] as { title: string }).title, " Rule S1 ");
    assert.ok(nvim.commands.some((c) => c.includes("hi default SonarLintSimpleBold")));
    assert.deepEqual(KEYS.filter((k) => !keys.has(`${b.bufnr}:${k}`)), []);
    assert.ok(autocmds.some((a) => a.event === "VimResized") && autocmds.some((a) => a.event === "BufWipeout" && a.buffer === b.bufnr));
});

test("reuse on the same name; a foreign buffer with the name gets a token", async () => {
    const { nvim, view } = setup();
    await view.show({ name: "v", title: "A", html: "<p>one</p>" });
    await view.show({ name: "v", title: "B", html: "<p>two</p>" });
    const named = nvim.bufs.filter((b) => b.name.startsWith("v"));
    assert.equal(named.length, 1);
    assert.deepEqual(named[0].lines, ["two"]);
    nvim.bufs.push({ bufnr: 50, name: "w", lines: ["mine"], opts: {}, hl: [] });
    await view.show({ name: "w", title: "W", html: "<p>x</p>" });
    assert.deepEqual(nvim.buf(50).lines, ["mine"]);
    assert.ok(nvim.bufs.some((b) => /^w \[\w+\]$/.test(b.name) && b.lines[0] === "x"));
});

test("Vim: botright vsplit, statusline title, width from the window", async () => {
    const nvim = new FakeNvim();
    nvim.nvim = false;
    const { view } = setup(nvim);
    await view.show({ name: "v", title: "50% done", html: "<p>" + "word ".repeat(30) + "</p>" });
    assert.ok(nvim.commands.some((c) => c.startsWith("botright vsplit | buffer ")));
    const b = nvim.bufs.find((x) => x.name === "v") as Buf;
    const w = nvim.wins.get(nvim.winOf(b.bufnr));
    assert.equal(w?.opts["&statusline"], "50%% done");
    assert.ok(b.lines.every((l) => l.length <= 60) && b.lines.length > 1);
    assert.equal(nvim.floats.length, 0);
});

test("tabs: <CR> on a title selects, ]c/[c cycle with wrap, cursor stays on the bar", async () => {
    const { nvim, view, press } = setup();
    await view.show({ name: "t", title: "T", html: TABS });
    const b = nvim.bufs.find((x) => x.name === "t") as Buf;
    const text = () => b.lines.join("\n");
    assert.match(text(), /first panel/);
    assert.doesNotMatch(text(), /second panel/);
    const state = view.state(b.bufnr);
    const two = state?.rendered?.tabs.find((t) => t.index === 1);
    assert.ok(two);
    nvim.cursor = [two.lnum, two.colStart + 1];
    await press(b.bufnr, "<CR>");
    assert.match(text(), /second panel/);
    assert.equal(nvim.cursor[0], two.lnum);
    await press(b.bufnr, "]c");
    assert.match(text(), /third panel/);
    await press(b.bufnr, "]c");
    assert.match(text(), /first panel/);
    nvim.cursor = [b.lines.length - 1, 0];
    await press(b.bufnr, "[c");
    assert.match(text(), /third panel/);
});

test("links: <Tab> moves, gx opens http, #fragment jumps", async () => {
    const { nvim, view, press, opened } = setup();
    const html = '<p><a href="https://x.io/a">ext</a> and <a href="#far">down</a></p>' + "<p>pad</p>".repeat(5) + '<h3 id="far">Far</h3>';
    await view.show({ name: "l", title: "L", html });
    const b = nvim.bufs.find((x) => x.name === "l") as Buf;
    nvim.cursor = [0, 0];
    await press(b.bufnr, "gx");
    assert.deepEqual(opened, ["https://x.io/a"]);
    await press(b.bufnr, "<Tab>");
    assert.deepEqual(nvim.cursor, [0, "ext and ".length]);
    await press(b.bufnr, "<CR>");
    assert.equal(b.lines[nvim.cursor[0]], "▸ Far");
    await press(b.bufnr, "<S-Tab>");
    assert.deepEqual(nvim.cursor, [0, "ext and ".length]);
    await press(b.bufnr, "<S-Tab>");
    assert.deepEqual(nvim.cursor, [0, 0]);
});

test("re-layout on a width change, not without one", async () => {
    const nvim = new FakeNvim();
    nvim.nvim = false;
    const { view, autocmds } = setup(nvim);
    await view.show({ name: "r", title: "R", html: "<p>" + "word ".repeat(30) + "</p>" });
    const b = nvim.bufs.find((x) => x.name === "r") as Buf;
    const narrow = b.lines.length;
    const resized = autocmds.find((a) => a.event === "VimResized");
    const writes = () => nvim.calls.filter(([f]) => f === "setbufline").length;
    const before = writes();
    await resized?.callback();
    assert.equal(writes(), before);
    (nvim.wins.get(nvim.winOf(b.bufnr)) as { width: number }).width = 200;
    await resized?.callback();
    assert.ok(b.lines.length < narrow);
    nvim.tabstop = 4;
    await resized?.callback();
    assert.equal(writes(), before + 2);
});

test("a failure never throws: one error line and a log", async () => {
    const { nvim, view, logs } = setup();
    await view.show({ name: "e", title: "E", html: "<p>x</p>", prepass: () => { throw new Error("boom"); } });
    const b = nvim.bufs.find((x) => x.name === "e") as Buf;
    assert.deepEqual(b.lines, ["[sonarlint] cannot show the view: boom"]);
    assert.ok(logs.some((l) => l.includes("boom")));
});

test("the buffer is unlocked while its window opens (autocmds may set options) and locked once shown", async () => {
    const nvim = new FakeNvim();
    const atOpen: unknown[] = [];
    const call = nvim.call.bind(nvim);
    nvim.call = async (fn: string, args: unknown[] = []): Promise<unknown> => {
        if (fn === "nvim_open_win") {
            atOpen.push(nvim.bufs.find((x) => x.bufnr === args[0])?.opts["&modifiable"]);
        }
        return call(fn, args);
    };
    const { view } = setup(nvim);
    await view.show({ name: "m", title: "M", html: "<p>one</p>" });
    const b = nvim.bufs.find((x) => x.name === "m") as Buf;
    assert.deepEqual(atOpen, [1], "modifiable when the float opens");
    assert.equal(b.opts["&modifiable"], 0, "locked after the write");
});
