/**
 * Light DOM to boxes: block boxes (with margins in lines and indents in cells), anonymous inline runs, `pre` boxes,
 * lists with their markers, tables, rules and tab groups. The per-tag defaults below stand in for coc-htmlview's
 * user-agent sheet; there is no CSS. A block met inside an inline element is lifted out as a block (keeping the
 * inherited inline style), so nothing is dropped and lines break where a browser breaks them.
 */
import { classes, DomElement, DomNode } from "./parse";
import { detectTabs, indexTabs, TabGroup, TabIndex } from "./tabs";

/** Highlight groups of the built-in renderer (the view defines the custom ones with `hi default`). */
export const Groups = {
    title: "Title",
    link: "Underlined",
    code: "Special",
    faint: "Comment",
    mark: "Search",
    added: "DiffAdd",
    removed: "DiffDelete",
    bold: "SonarLintSimpleBold",
    italic: "SonarLintSimpleItalic",
    strike: "SonarLintSimpleStrike",
} as const;

/** Inline style inherited down the tree. */
export interface InlineStyle {
    groups: readonly string[];
    /** Target of the enclosing link. */
    link?: string;
}

export type Inline =
    | { kind: "text"; text: string; style: InlineStyle }
    | { kind: "br" }
    | { kind: "anchor"; id: string };

/** An anonymous run of inline content; `pre` keeps white space and never wraps. */
export interface InlineBox {
    kind: "inline";
    items: Inline[];
    pre: boolean;
}

interface Edges {
    mt: number;
    mb: number;
    /** Ids that point at the box's first line. */
    anchors: string[];
}

export interface BlockBox extends Edges {
    kind: "block";
    ml: number;
    mr: number;
    /** A quote bar on the left (`│ `). */
    bar: boolean;
    children: Box[];
}

/** Preformatted content in a faint box; its children are laid out unwrapped. */
export interface PreBox extends Edges {
    kind: "pre";
    children: Box[];
}

export interface ListItem {
    /** The marker with its trailing space (`• `, `3. `); `""` for content that is not an item. */
    marker: string;
    anchors: string[];
    children: Box[];
}

export interface ListBox extends Edges {
    kind: "list";
    items: ListItem[];
}

export interface TableCell {
    span: number;
    header: boolean;
    children: Box[];
}

export interface TableRow {
    /** A row of `thead`. */
    header: boolean;
    cells: TableCell[];
}

export interface TableBox extends Edges {
    kind: "table";
    /** Captions and content misplaced in the table, shown above it. */
    captions: Box[][];
    rows: TableRow[];
}

export interface RuleBox extends Edges {
    kind: "hr";
}

/** A recognised tab group: its titles and panels, in order. */
export interface TabsBox extends Edges {
    kind: "tabs";
    group: string;
    checked: number;
    titles: InlineBox[];
    panels: Box[][];
}

export type Box = InlineBox | BlockBox | PreBox | ListBox | TableBox | RuleBox | TabsBox;

type Display = "block" | "inline" | "none" | "list" | "item" | "table" | "pre" | "hr" | "br" | "img" | "select" | "heading" | "details" | "summary" | "control";

interface TagDefaults {
    display: Display;
    mt?: number;
    mb?: number;
    ml?: number;
    mr?: number;
    bar?: boolean;
    group?: string;
}

/** The per-tag defaults (coc-htmlview's user-agent sheet, in lines and cells); unknown tags are inline. */
const TAGS: Record<string, TagDefaults> = {};
function define(tags: string, d: TagDefaults): void {
    tags.split(" ").forEach((t: string): void => {
        TAGS[t] = d;
    });
}
define("html body div section main article header footer nav aside address hgroup figcaption dt form fieldset legend center dialog search caption tbody thead tfoot tr td th option optgroup", { display: "block" });
define("p dl", { display: "block", mt: 1, mb: 1 });
define("figure", { display: "block", mt: 1, mb: 1, ml: 4, mr: 4 });
define("dd", { display: "block", ml: 4 });
define("blockquote", { display: "block", mt: 1, mb: 1, ml: 2, mr: 2, bar: true });
define("h1 h2 h3 h4 h5 h6", { display: "heading", mt: 1, mb: 1, group: Groups.title });
define("ul ol menu dir", { display: "list", mt: 1, mb: 1 });
define("li", { display: "item" });
define("pre listing xmp plaintext", { display: "pre", mt: 1, mb: 1 });
define("hr", { display: "hr", mt: 1, mb: 1 });
define("table", { display: "table" });
define("details", { display: "details", mt: 1, mb: 1 });
define("summary", { display: "summary" });
define("br", { display: "br" });
define("img", { display: "img" });
define("select datalist", { display: "select" });
define("input", { display: "control" });
define("wbr area map track source param col colgroup", { display: "none" });
define("strong b", { display: "inline", group: Groups.bold });
define("em i cite var dfn", { display: "inline", group: Groups.italic });
define("code kbd samp tt", { display: "inline", group: Groups.code });
define("u ins", { display: "inline", group: Groups.link });
define("del s strike", { display: "inline", group: Groups.strike });
define("mark", { display: "inline", group: Groups.mark });

const HEADING_MARKERS: Record<string, string> = { h1: "◉", h2: "◆", h3: "▸", h4: "▹", h5: "‣", h6: "•" };
const BULLETS: string[] = ["•", "◦", "▪"];
const BULLET_TYPES: Record<string, string> = { disc: "•", circle: "◦", square: "▪" };

interface Context {
    style: InlineStyle;
    pre: boolean;
    /** Enclosing `ul`/`ol` count (bullet choice). */
    lists: number;
    /** Inside a list or definition list (nested lists lose their margins). */
    inList: boolean;
}

interface Acc {
    out: Box[];
    cur: InlineBox | undefined;
}

/** Defaults of a tag (unknown tags are inline). */
export function tagDefaults(tag: string): TagDefaults {
    return TAGS[tag] ?? { display: "inline" };
}

function roman(n: number): string {
    const table: Array<[number, string]> = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let out = "";
    let rest = n;
    table.forEach(([v, s]: [number, string]): void => {
        while (rest >= v) {
            out += s;
            rest -= v;
        }
    });
    return out;
}

function alpha(n: number): string {
    let out = "";
    let rest = n;
    while (rest > 0) {
        rest -= 1;
        out = String.fromCharCode(97 + (rest % 26)) + out;
        rest = Math.floor(rest / 26);
    }
    return out;
}

/** An ordered list number in the list's `type` (1, a, A, i, I). */
export function olNumber(n: number, type: string): string {
    let out: string;
    if (n <= 0 || type === "1" || type === "") {
        out = String(n);
    } else if (type === "a" || type === "A") {
        out = type === "A" ? alpha(n).toUpperCase() : alpha(n);
    } else if (type === "i" || type === "I") {
        out = type === "I" ? roman(n).toUpperCase() : roman(n);
    } else {
        out = String(n);
    }
    return out;
}

function diffGroup(el: DomElement): string | undefined {
    const words = classes(el).map((c: string): string[] => c.toLowerCase().split(/[-_]/));
    const has = (w: string[]): boolean => words.some((ws: string[]): boolean => ws.some((x: string): boolean => w.indexOf(x) >= 0));
    return has(["added", "inserted"]) ? Groups.added : has(["removed", "deleted"]) ? Groups.removed : undefined;
}

function parseIntAttr(v: string | undefined): number | undefined {
    const n = v !== undefined ? parseInt(v, 10) : NaN;
    return isNaN(n) ? undefined : n;
}

class Builder {
    private readonly emitted: Set<TabGroup> = new Set();

    constructor(private readonly tabs: TabIndex) {}

    flow(nodes: DomNode[], ctx: Context): Box[] {
        const acc: Acc = { out: [], cur: undefined };
        nodes.forEach((n: DomNode): void => this.node(n, ctx, acc));
        return acc.out;
    }

    private inline(acc: Acc, ctx: Context, item: Inline): void {
        if (acc.cur === undefined) {
            acc.cur = { kind: "inline", items: [], pre: ctx.pre };
            acc.out.push(acc.cur);
        }
        acc.cur.items.push(item);
    }

    private blocks(acc: Acc, boxes: Box[]): void {
        acc.cur = undefined;
        boxes.forEach((b: Box): void => {
            acc.out.push(b);
        });
    }

    private node(n: DomNode, ctx: Context, acc: Acc): void {
        if (n.kind === "text") {
            this.inline(acc, ctx, { kind: "text", text: n.text, style: ctx.style });
        } else {
            const group: TabGroup | undefined = this.tabs.get(n);
            if (group !== undefined && n.tag !== "input") {
                if (!this.emitted.has(group)) {
                    this.emitted.add(group);
                    this.blocks(acc, [this.tabGroup(group, ctx)]);
                }
            } else {
                this.element(n, ctx, acc);
            }
        }
    }

    private element(el: DomElement, ctx: Context, acc: Acc): void {
        const d = tagDefaults(el.tag);
        const id = el.attrs["id"] ?? (el.tag === "a" ? el.attrs["name"] : undefined);
        const anchors: string[] = id !== undefined && id !== "" ? [id] : [];
        if (d.display === "inline" || d.display === "control" || d.display === "br" || d.display === "img" || d.display === "select" || d.display === "none") {
            anchors.forEach((a: string): void => this.inline(acc, ctx, { kind: "anchor", id: a }));
            this.inlineElement(el, d, ctx, acc);
        } else {
            this.blocks(acc, this.block(el, d, ctx, anchors));
        }
    }

    private inlineElement(el: DomElement, d: TagDefaults, ctx: Context, acc: Acc): void {
        if (d.display === "br") {
            this.inline(acc, ctx, { kind: "br" });
        } else if (d.display === "img") {
            const alt = (el.attrs["alt"] ?? "").trim();
            if (alt !== "") {
                this.inline(acc, ctx, { kind: "text", text: `[${alt}]`, style: ctx.style });
            }
        } else if (d.display === "select") {
            const options: DomElement[] = [];
            const collect = (e: DomElement): void => {
                e.children.forEach((c: DomNode): void => {
                    if (c.kind === "element" && c.tag === "option") {
                        options.push(c);
                    } else if (c.kind === "element") {
                        collect(c);
                    }
                });
            };
            collect(el);
            const chosen = options.find((o: DomElement): boolean => "selected" in o.attrs) ?? options[0];
            if (chosen !== undefined) {
                chosen.children.forEach((c: DomNode): void => this.node(c, ctx, acc));
            }
        } else if (d.display === "inline") {
            const groups: string[] = ctx.style.groups.slice();
            if (d.group !== undefined) {
                groups.push(d.group);
            }
            const href = el.tag === "a" ? el.attrs["href"] : undefined;
            if (href !== undefined) {
                groups.push(Groups.link);
            }
            const diff = ctx.pre ? diffGroup(el) : undefined;
            if (diff !== undefined) {
                groups.push(diff);
            }
            const style: InlineStyle = { groups, link: href !== undefined ? href : ctx.style.link };
            el.children.forEach((c: DomNode): void => this.node(c, { ...ctx, style }, acc));
        }
    }

    private withGroup(ctx: Context, group: string | undefined): Context {
        return group === undefined ? ctx : { ...ctx, style: { ...ctx.style, groups: ctx.style.groups.concat([group]) } };
    }

    private block(el: DomElement, d: TagDefaults, ctx: Context, anchors: string[]): Box[] {
        let out: Box[];
        const edges = { mt: d.mt ?? 0, mb: d.mb ?? 0, anchors };
        if (ctx.pre) {
            const diff = diffGroup(el);
            const inner = this.flow(el.children, this.withGroup(ctx, diff));
            out = [{ kind: "block", mt: 0, mb: 0, anchors, ml: 0, mr: 0, bar: false, children: inner }];
        } else if (d.display === "heading") {
            const hctx = this.withGroup(ctx, d.group);
            const marker: Inline = { kind: "text", text: `${HEADING_MARKERS[el.tag]} `, style: hctx.style };
            const acc: Acc = { out: [], cur: undefined };
            this.inline(acc, hctx, marker);
            el.children.forEach((c: DomNode): void => this.node(c, hctx, acc));
            out = [{ kind: "block", ...edges, ml: 0, mr: 0, bar: false, children: acc.out }];
        } else if (d.display === "list") {
            out = [this.list(el, ctx, edges)];
        } else if (d.display === "pre") {
            out = [{ kind: "pre", ...edges, children: this.flow(el.children, { ...ctx, pre: true }) }];
        } else if (d.display === "hr") {
            out = [{ kind: "hr", ...edges }];
        } else if (d.display === "table") {
            out = [this.table(el, ctx, anchors)];
        } else if (d.display === "details") {
            const hasSummary = el.children.some((c: DomNode): boolean => c.kind === "element" && c.tag === "summary");
            const lead: Box[] = hasSummary ? [] : [{ kind: "inline", pre: false, items: [{ kind: "text", text: "▾ Details", style: ctx.style }] }];
            out = [{ kind: "block", ...edges, ml: 0, mr: 0, bar: false, children: lead.concat(this.flow(el.children, ctx)) }];
        } else if (d.display === "summary") {
            const acc: Acc = { out: [], cur: undefined };
            this.inline(acc, ctx, { kind: "text", text: "▾ ", style: ctx.style });
            el.children.forEach((c: DomNode): void => this.node(c, ctx, acc));
            out = [{ kind: "block", ...edges, ml: 0, mr: 0, bar: false, children: acc.out }];
        } else if (d.display === "item") {
            out = [this.list({ ...el, tag: "ul", children: [el] }, ctx, { mt: 0, mb: 0, anchors: [] })];
        } else {
            const nested = el.tag === "dl" ? { ...ctx, inList: true } : ctx;
            const dl = el.tag === "dl" && ctx.inList;
            out = [{ kind: "block", ...edges, mt: dl ? 0 : edges.mt, mb: dl ? 0 : edges.mb, ml: d.ml ?? 0, mr: d.mr ?? 0, bar: d.bar === true, children: this.flow(el.children, nested) }];
        }
        return out;
    }

    private list(el: DomElement, ctx: Context, edges: Edges): ListBox {
        const ordered = el.tag === "ol";
        const lis = el.children.filter((c: DomNode): boolean => c.kind === "element" && c.tag === "li") as DomElement[];
        const reversed = ordered && "reversed" in el.attrs;
        const step = reversed ? -1 : 1;
        let n = parseIntAttr(el.attrs["start"]) ?? (reversed ? lis.length : 1);
        const type = el.attrs["type"] ?? "";
        const bullet = BULLET_TYPES[type.toLowerCase()] ?? BULLETS[Math.min(ctx.lists, BULLETS.length - 1)];
        const inner: Context = { ...ctx, lists: ctx.lists + 1, inList: true };
        const items: ListItem[] = [];
        let loose: DomNode[] = [];
        const flushLoose = (): void => {
            const boxes = this.flow(loose, inner);
            if (loose.some((c: DomNode): boolean => c.kind === "element" || c.text.trim() !== "")) {
                items.push({ marker: "", anchors: [], children: boxes });
            }
            loose = [];
        };
        el.children.forEach((c: DomNode): void => {
            if (c.kind === "element" && c.tag === "li") {
                flushLoose();
                n = parseIntAttr(c.attrs["value"]) ?? n;
                const marker = ordered ? `${olNumber(n, c.attrs["type"] ?? type)}. ` : `${bullet} `;
                const id = c.attrs["id"];
                items.push({ marker, anchors: id !== undefined && id !== "" ? [id] : [], children: this.flow(c.children, inner) });
                n += step;
            } else {
                loose.push(c);
            }
        });
        flushLoose();
        const nested = ctx.inList;
        return { kind: "list", mt: nested ? 0 : edges.mt, mb: nested ? 0 : edges.mb, anchors: edges.anchors, items };
    }

    private table(el: DomElement, ctx: Context, anchors: string[]): TableBox {
        const rows: TableRow[] = [];
        const captions: Box[][] = [];
        const cellCtx: Context = { ...ctx, inList: false };
        let open: TableRow | undefined;
        const cell = (c: DomElement): TableCell => {
            const header = c.tag === "th";
            const span = Math.max(1, Math.min(1000, parseIntAttr(c.attrs["colspan"]) ?? 1));
            return { span, header, children: this.own(c, header ? this.withGroup(cellCtx, Groups.title) : cellCtx) };
        };
        const row = (tr: DomElement, header: boolean): void => {
            const cells: TableCell[] = [];
            const stray: DomNode[] = [];
            tr.children.forEach((c: DomNode): void => {
                if (c.kind === "element" && (c.tag === "td" || c.tag === "th")) {
                    cells.push(cell(c));
                } else {
                    stray.push(c);
                }
            });
            this.stray(stray, ctx, captions);
            rows.push({ header, cells });
        };
        const section = (nodes: DomNode[], header: boolean): void => {
            const stray: DomNode[] = [];
            nodes.forEach((c: DomNode): void => {
                if (c.kind === "element" && c.tag === "tr") {
                    open = undefined;
                    row(c, header);
                } else if (c.kind === "element" && (c.tag === "td" || c.tag === "th")) {
                    if (open === undefined) {
                        open = { header, cells: [] };
                        rows.push(open);
                    }
                    open.cells.push(cell(c));
                } else if (c.kind === "element" && (c.tag === "thead" || c.tag === "tbody" || c.tag === "tfoot")) {
                    open = undefined;
                    section(c.children, c.tag === "thead");
                } else if (c.kind === "element" && c.tag === "caption") {
                    captions.push(this.own(c, ctx));
                } else {
                    stray.push(c);
                }
            });
            this.stray(stray, ctx, captions);
        };
        section(el.children, false);
        return { kind: "table", mt: 0, mb: 0, anchors, captions, rows: rows.filter((r: TableRow): boolean => r.cells.length > 0) };
    }

    /** Content misplaced inside a table structure is shown above the table, as browsers do. */
    private stray(nodes: DomNode[], ctx: Context, captions: Box[][]): void {
        if (nodes.some((c: DomNode): boolean => c.kind === "element" || c.text.trim() !== "")) {
            captions.push(this.flow(nodes, ctx));
        }
    }

    private tabGroup(group: TabGroup, ctx: Context): TabsBox {
        const titles: InlineBox[] = group.tabs.map((t): InlineBox => {
            const items: Inline[] = [];
            this.flow(t.label.children, ctx).forEach((b: Box): void => {
                collectInline(b, items);
            });
            return { kind: "inline", pre: false, items };
        });
        const panels: Box[][] = group.tabs.map((t): Box[] => this.own(t.panel, ctx));
        return { kind: "tabs", mt: 0, mb: 0, anchors: [], group: group.id, checked: group.checked, titles, panels };
    }

    /** The boxes of one element (a tab panel, a caption), its own anchors included. */
    private own(el: DomElement, ctx: Context): Box[] {
        const acc: Acc = { out: [], cur: undefined };
        this.element(el, ctx, acc);
        return acc.out;
    }
}

/** The boxes directly inside `box`, in reading order. */
function childBoxes(box: Box): Box[] {
    let out: Box[] = [];
    if (box.kind === "block" || box.kind === "pre") {
        out = box.children;
    } else if (box.kind === "list") {
        out = ([] as Box[]).concat(...box.items.map((it: ListItem): Box[] => it.children));
    } else if (box.kind === "table") {
        out = ([] as Box[]).concat(...box.captions, ...box.rows.map((r: TableRow): Box[] => ([] as Box[]).concat(...r.cells.map((c: TableCell): Box[] => c.children))));
    } else if (box.kind === "tabs") {
        out = ([] as Box[]).concat(...box.titles.map((t: InlineBox, i: number): Box[] => [t as Box].concat(box.panels[i])));
    }
    return out;
}

/** The inline items of a box tree, blocks joined by spaces (a tab title is one line). */
function collectInline(box: Box, out: Inline[]): void {
    if (box.kind === "inline") {
        box.items.forEach((i: Inline): void => {
            out.push(i.kind === "br" ? { kind: "text", text: " ", style: { groups: [] } } : i);
        });
    } else {
        out.push({ kind: "text", text: " ", style: { groups: [] } });
        childBoxes(box).forEach((b: Box): void => collectInline(b, out));
    }
}

/** Builds the boxes of a parsed document, with its tab groups. */
export function buildBoxes(root: DomElement): { boxes: Box[]; groups: TabGroup[] } {
    const groups = detectTabs(root);
    const builder = new Builder(indexTabs(groups));
    const boxes = builder.flow(root.children, { style: { groups: [] }, pre: false, lists: 0, inList: false });
    return { boxes, groups };
}
