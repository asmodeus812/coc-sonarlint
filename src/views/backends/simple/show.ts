/**
 * The built-in view: a scratch buffer showing `renderSimple` output, in a Neovim float when `nvim_open_win` exists,
 * else a `botright vsplit` (Vim). Everything goes through Vim script calls coc forwards to either editor; there is no
 * Lua and no Neovim-only call without the split fallback. Tabs switch like a browser (re-render with the new
 * selection), links open or jump, and the view re-lays out when its window width or 'tabstop' changes.
 */
import { renderSimple, Rendered } from "./render";
import { Groups } from "./boxes";

/** The editor calls the view needs (a subset of coc's `Neovim`). */
export interface ViewNvim {
    command(cmd: string): Promise<unknown>;
    call(fn: string, args?: unknown[]): Promise<unknown>;
    eval(expr: string): Promise<unknown>;
}

export interface Disposable {
    dispose(): void;
}

/** What the view takes from coc; injectable so tests run without the coc runtime. */
export interface ViewHost {
    nvim: ViewNvim;
    registerLocalKeymap(bufnr: number, mode: "n", lhs: string, fn: () => unknown, opts?: { silent?: boolean; sync?: boolean }): Disposable;
    registerAutocmd(autocmd: { event: string; buffer?: number; callback: (...args: unknown[]) => void | Promise<void> }): Disposable;
    openResource(uri: string): Promise<void>;
    log(message: string): void;
}

/** One view to show: buffer name (reuse key), title and the HTML after any pre-pass. */
export interface ShowRequest {
    name: string;
    title: string;
    html: string;
    /** Rewrites `html` before rendering; a failure shows as the error line. */
    prepass?: (html: string) => string;
}

interface ViewState {
    bufnr: number;
    title: string;
    html: string;
    /** Why the HTML could not be prepared (the pre-pass threw); shown instead of the page. */
    error: string | undefined;
    selected: Record<string, number>;
    rendered: Rendered | undefined;
    width: number;
    tabstop: number;
    disposables: Disposable[];
}

/** The buffer-local keys, in the order they are registered. */
export const KEYS = ["q", "<CR>", "gx", "]c", "[c", "<Tab>", "<S-Tab>"] as const;

const NS = "sonarlint-simple";

/** A Vim single-quoted string literal. */
function vimStr(text: string): string {
    return `'${text.replace(/'/g, "''")}'`;
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** The one-line page shown when a view cannot be shown. */
function errorPage(reason: string): Rendered {
    const text = `[sonarlint] cannot show the view: ${reason}`;
    return { lines: [text], highlights: [{ lnum: 0, colStart: 0, colEnd: 11, hlGroup: "ErrorMsg" }], links: [], tabs: [], anchors: {}, groups: [] };
}

/** A `#fragment` percent-decoded, or as written when it is not valid percent-encoding. */
function decodeFragment(fragment: string): string {
    let out = fragment;
    try {
        out = decodeURIComponent(fragment);
    } catch (e) {
        out = fragment;
    }
    return out;
}

/** True when (a, b) comes before (c, d). */
function before(a: number, b: number, c: number, d: number): boolean {
    return a < c || (a === c && b < d);
}

/** Float geometry centred in the editor for `height` lines. */
export function floatConfig(columns: number, lines: number, height: number): Record<string, unknown> {
    const width = Math.max(20, Math.min(100, columns - 8));
    const h = Math.max(1, Math.min(height, lines - 6));
    return {
        relative: "editor",
        width,
        height: h,
        row: Math.max(0, Math.floor((lines - h) / 2) - 1),
        col: Math.max(0, Math.floor((columns - width - 2) / 2)),
    };
}

let tokens = 0;

/** Shows built-in views and owns their buffers, keys and refresh. */
export class SimpleView {
    private readonly views = new Map<number, ViewState>();
    /** The last queued write per buffer (see `write`). */
    private readonly writes = new Map<number, Promise<void>>();
    /** Every buffer this view created (reused under its name even after `:bdelete` cleared its options and keys). */
    private readonly owned = new Set<number>();
    /** The last queued `show` (shows run one at a time, so two cannot set up the same buffer). */
    private shows: Promise<void> = Promise.resolve();
    private global: Disposable[] = [];

    constructor(private readonly host: ViewHost) {}

    /** Shows `req`; never throws: a failure is logged and shown as one line in the buffer when there is one. */
    show(req: ShowRequest): Promise<void> {
        const next = this.shows.then(() => this.showNow(req));
        this.shows = next;
        return next;
    }

    private async showNow(req: ShowRequest): Promise<void> {
        let bufnr = -1;
        try {
            await this.setup();
            bufnr = await this.buffer(req.name);
            const known = this.views.get(bufnr);
            if (known === undefined) {
                await this.prepare(bufnr);
            }
            const state: ViewState = known ?? {
                bufnr, title: req.title, html: "", error: undefined, selected: {}, rendered: undefined, width: 0, tabstop: 8, disposables: [],
            };
            state.title = req.title;
            this.prepass(state, req);
            state.selected = {};
            this.views.set(bufnr, state);
            if (known === undefined) {
                this.bind(state);
            }
            await this.open(state);
            await this.refresh(state, true);
            await this.cursor(state, 0, 0);
        } catch (e) {
            this.host.log(`[simple view] ${req.name}: ${message(e)}`);
            await this.writeError(bufnr, message(e));
        }
    }

    /** Sets the HTML to render; a failing pre-pass is logged and leaves the error to show instead. */
    private prepass(state: ViewState, req: ShowRequest): void {
        state.html = req.html;
        state.error = undefined;
        try {
            state.html = req.prepass !== undefined ? req.prepass(req.html) : req.html;
        } catch (e) {
            state.error = message(e);
            this.host.log(`[simple view] ${req.name}: ${state.error}`);
        }
    }

    /** The state of the view in `bufnr` (tests). */
    state(bufnr: number): Readonly<ViewState> | undefined {
        return this.views.get(bufnr);
    }

    dispose(): void {
        this.views.forEach((s) => s.disposables.forEach((d) => d.dispose()));
        this.views.clear();
        this.global.forEach((d) => d.dispose());
        this.global = [];
    }

    private async setup(): Promise<void> {
        if (this.global.length === 0) {
            this.global.push(this.host.registerAutocmd({ event: "VimResized", callback: () => this.safe(() => this.resized()) }));
            this.global.push(this.host.registerAutocmd({ event: "ColorScheme", callback: () => this.safe(() => this.defineGroups()) }));
            if (((await this.host.nvim.eval("exists('##WinResized')")) as number) === 1) {
                this.global.push(this.host.registerAutocmd({ event: "WinResized", callback: () => this.safe(() => this.resized()) }));
            }
            await this.defineGroups();
        }
    }

    /** `hi default` for the renderer's own groups (Vim and Neovim; strikethrough is silent where unsupported). */
    private async defineGroups(): Promise<void> {
        await this.host.nvim.command([
            `hi default ${Groups.bold} term=bold cterm=bold gui=bold`,
            `hi default ${Groups.italic} term=italic cterm=italic gui=italic`,
            `silent! hi default ${Groups.strike} term=strikethrough cterm=strikethrough gui=strikethrough`,
        ].join(" | "));
    }

    /** The view buffer for `name`: ours when we made it, else a new buffer (a token in the name on a clash). */
    private async buffer(name: string): Promise<number> {
        const nvim = this.host.nvim;
        const expr = `get(filter(getbufinfo(), {_, b -> b.name ==# ${vimStr(name)} || b.name ==# fnamemodify(${vimStr(name)}, ':p')}), 0, {'bufnr': -1}).bufnr`;
        const existing = (await nvim.eval(expr)) as number;
        let bufnr = existing;
        if (existing <= 0 || !this.owned.has(existing)) {
            tokens += 1;
            const unique = existing > 0 ? `${name} [${Date.now().toString(36)}${tokens}]` : name;
            bufnr = (await nvim.call("bufadd", [unique])) as number;
            this.owned.add(bufnr);
        }
        return bufnr;
    }

    /** Scratch options and a loaded buffer; set on every new view since `:bdelete` clears buffer options. */
    private async prepare(bufnr: number): Promise<void> {
        const nvim = this.host.nvim;
        for (const [opt, value] of [["&buftype", "nofile"], ["&bufhidden", "hide"], ["&swapfile", 0]] as const) {
            await nvim.call("setbufvar", [bufnr, opt, value]);
        }
        await nvim.call("bufload", [bufnr]);
    }

    /** Buffer-local keys and autocmds of a new view. */
    private bind(state: ViewState): void {
        const key = (lhs: string, fn: () => Promise<void>): Disposable =>
            this.host.registerLocalKeymap(state.bufnr, "n", lhs, () => this.safe(fn), { silent: true, sync: false });
        state.disposables.push(
            key("q", () => this.close(state)),
            key("<CR>", () => this.enter(state)),
            key("gx", () => this.follow(state)),
            key("]c", () => this.cycle(state, 1)),
            key("[c", () => this.cycle(state, -1)),
            key("<Tab>", () => this.jumpLink(state, 1)),
            key("<S-Tab>", () => this.jumpLink(state, -1)),
            this.host.registerAutocmd({ event: "BufWinEnter", buffer: state.bufnr, callback: () => this.safe(() => this.refresh(state, false)) }),
            this.host.registerAutocmd({ event: "BufUnload", buffer: state.bufnr, callback: () => this.forget(state) }),
        );
    }

    /** Drops a view whose buffer is unloaded (`:bdelete`, `:bunload`, `:bwipeout`): its keys and options are gone. */
    private forget(state: ViewState): void {
        state.disposables.forEach((d) => d.dispose());
        this.views.delete(state.bufnr);
        this.writes.delete(state.bufnr);
    }

    /** Runs a key or autocmd handler, logging instead of throwing. */
    private async safe(fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
        } catch (e) {
            this.host.log(`[simple view] ${message(e)}`);
        }
    }

    private async winid(state: ViewState): Promise<number> {
        return (await this.host.nvim.call("bufwinid", [state.bufnr])) as number;
    }

    /** Focuses the view's window, opening a float (Neovim) or a right split (Vim) when it is not shown. */
    private async open(state: ViewState): Promise<void> {
        const nvim = this.host.nvim;
        // unlocked while its window opens or is entered: the user's BufEnter/BufWinEnter/WinEnter autocmds may set
        // buffer options such as 'fileformat', which raises E21 on a locked buffer; the following write locks it again
        await nvim.call("setbufvar", [state.bufnr, "&modifiable", 1]);
        const shown = await this.winid(state);
        let winid = shown;
        if (shown !== -1) {
            await nvim.call("win_gotoid", [shown]);
        } else if (((await nvim.eval("has('nvim') && exists('*nvim_open_win')")) as number) === 1) {
            const [columns, lines] = (await nvim.eval("[&columns, &lines - &cmdheight]")) as [number, number];
            const config = { ...floatConfig(columns, lines, 1), style: "minimal", border: "rounded", zindex: 50 };
            winid = (await nvim.call("nvim_open_win", [state.bufnr, true, { ...config, title: ` ${state.title} `, title_pos: "center" }])
                .catch(() => nvim.call("nvim_open_win", [state.bufnr, true, config]))) as number;
        } else {
            await nvim.command(`botright vsplit | buffer ${state.bufnr}`);
            winid = (await nvim.call("win_getid", [])) as number;
        }
        await nvim.call("setwinvar", [winid, "&wrap", 0]);
        await nvim.call("setwinvar", [winid, "&statusline", state.title.replace(/%/g, "%%")]);
    }

    /**
     * Re-renders when `force`, or when the window width or 'tabstop' changed; a float (whichever window shows the
     * buffer now, not the one it was opened in) follows the new size.
     */
    private async refresh(state: ViewState, force: boolean): Promise<void> {
        const nvim = this.host.nvim;
        const winid = await this.winid(state);
        if (winid !== -1) {
            const expr = `[&columns, &lines - &cmdheight, getbufvar(${state.bufnr}, '&tabstop'), win_gettype(${winid}) ==# 'popup']`;
            const [columns, lines, tabstop, popup] = (await nvim.eval(expr)) as [number, number, number, number];
            const float = popup === 1;
            const width = float
                ? (floatConfig(columns, lines, 1).width as number)
                : ((await nvim.eval(`getwininfo(${winid})[0].width - get(getwininfo(${winid})[0], 'textoff', 0)`)) as number);
            if (force || width !== state.width || tabstop !== state.tabstop) {
                state.width = width;
                state.tabstop = tabstop;
                state.rendered = state.error !== undefined ? errorPage(state.error) : renderSimple(state.html, { width: Math.max(10, width), tabstop, selected: state.selected });
                await this.write(state.bufnr, state.rendered);
            }
            if (float) {
                await nvim.call("nvim_win_set_config", [winid, floatConfig(columns, lines, state.rendered?.lines.length ?? 1)]);
            }
        }
    }

    private async resized(): Promise<void> {
        for (const state of Array.from(this.views.values())) {
            await this.refresh(state, false);
        }
    }

    /**
     * Replaces the buffer's lines and highlights. Writes are queued per buffer, so a refresh (the window opening fires
     * one) cannot lock the buffer again between another write's unlock and its edit.
     */
    private write(bufnr: number, r: Pick<Rendered, "lines" | "highlights">): Promise<void> {
        const previous: Promise<void> = this.writes.get(bufnr) ?? Promise.resolve();
        const next: Promise<void> = previous.catch(() => undefined).then(() => this.writeNow(bufnr, r));
        this.writes.set(bufnr, next);
        return next;
    }

    private async writeNow(bufnr: number, r: Pick<Rendered, "lines" | "highlights">): Promise<void> {
        const nvim = this.host.nvim;
        await nvim.call("setbufvar", [bufnr, "&modifiable", 1]);
        await nvim.call("deletebufline", [bufnr, 1, "$"]);
        await nvim.call("setbufline", [bufnr, 1, r.lines]);
        await nvim.call("setbufvar", [bufnr, "&modifiable", 0]);
        await nvim.call("coc#highlight#clear_highlight", [bufnr, NS, 0, -1]);
        await nvim.call("coc#highlight#set", [bufnr, NS, r.highlights.map((h) => [h.hlGroup, h.lnum, h.colStart, h.colEnd, 0]), 100]);
    }

    private async writeError(bufnr: number, reason: string): Promise<void> {
        try {
            if (bufnr > 0) {
                await this.write(bufnr, errorPage(reason));
            }
        } catch (e) {
            this.host.log(`[simple view] error line: ${message(e)}`);
        }
    }

    /** The cursor as 0-based line and byte column. */
    private async position(): Promise<[number, number]> {
        return (await this.host.nvim.eval("[line('.') - 1, col('.') - 1]")) as [number, number];
    }

    private async cursor(state: ViewState, lnum: number, col: number): Promise<void> {
        const winid = await this.winid(state);
        if (winid !== -1) {
            await this.host.nvim.call("win_execute", [winid, `call cursor(${lnum + 1}, ${col + 1})`]);
        }
    }

    private async close(state: ViewState): Promise<void> {
        await this.host.nvim.command(`if bufnr('%') == ${state.bufnr} | execute winnr('$') > 1 ? 'close' : 'silent! buffer #' | endif`);
    }

    /** `<CR>`: selects the tab under the cursor, else follows the link under it. */
    private async enter(state: ViewState): Promise<void> {
        const [lnum, col] = await this.position();
        const tab = state.rendered?.tabs.find((t) => t.lnum === lnum && col >= t.colStart && col < t.colEnd);
        if (tab !== undefined) {
            await this.select(state, tab.group, tab.index);
        } else {
            await this.follow(state);
        }
    }

    /** Selects tab `index` of `group`, re-renders and puts the cursor on its title. */
    private async select(state: ViewState, group: string, index: number): Promise<void> {
        state.selected = { ...state.selected, [group]: index };
        await this.refresh(state, true);
        const title = state.rendered?.tabs.find((t) => t.group === group && t.index === index);
        if (title !== undefined) {
            await this.cursor(state, title.lnum, title.colStart);
        }
    }

    /** `]c`/`[c`: the next or previous tab of the group whose title is under or nearest the cursor (wrapping). */
    private async cycle(state: ViewState, step: number): Promise<void> {
        const r = state.rendered;
        const [lnum, col] = await this.position();
        const dist = (t: { lnum: number; colStart: number }): number => Math.abs(t.lnum - lnum) * 100000 + Math.abs(t.colStart - col);
        const nearest = r?.tabs.reduce<(typeof r.tabs)[number] | undefined>((best, t) => (best === undefined || dist(t) < dist(best) ? t : best), undefined);
        const info = nearest === undefined ? undefined : r?.groups.find((g) => g.id === nearest.group);
        if (nearest !== undefined && info !== undefined && info.titles.length > 0) {
            const current = state.selected[info.id] ?? info.checked;
            const n = info.titles.length;
            await this.select(state, info.id, (((current + step) % n) + n) % n);
        }
    }

    /** `gx` (and `<CR>` off a tab): opens the link under the cursor. */
    private async follow(state: ViewState): Promise<void> {
        const [lnum, col] = await this.position();
        const link = state.rendered?.links.find((l) => l.lnum === lnum && col >= l.colStart && col < l.colEnd);
        if (link !== undefined) {
            await this.openHref(state, link.href);
        }
    }

    /** `#id` jumps to its anchor line; a URL with a scheme opens through coc; anything else is logged. */
    private async openHref(state: ViewState, href: string): Promise<void> {
        const anchors = state.rendered?.anchors ?? {};
        const anchor = href.startsWith("#") ? anchors[href.slice(1)] ?? anchors[decodeFragment(href.slice(1))] : undefined;
        if (anchor !== undefined) {
            await this.cursor(state, anchor, 0);
        } else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            await this.host.openResource(href);
        } else {
            this.host.log(`[simple view] cannot open link ${href}`);
        }
    }

    /** `<Tab>`/`<S-Tab>`: the next or previous link start (wrapping). */
    private async jumpLink(state: ViewState, step: number): Promise<void> {
        const links = [...(state.rendered?.links ?? [])].sort((a, b) => a.lnum - b.lnum || a.colStart - b.colStart);
        const [lnum, col] = await this.position();
        const next = step > 0
            ? links.find((l) => before(lnum, col, l.lnum, l.colStart)) ?? links[0]
            : [...links].reverse().find((l) => before(l.lnum, l.colStart, lnum, col) && !(l.lnum === lnum && col < l.colEnd)) ?? links[links.length - 1];
        if (next !== undefined) {
            await this.cursor(state, next.lnum, next.colStart);
        }
    }
}
