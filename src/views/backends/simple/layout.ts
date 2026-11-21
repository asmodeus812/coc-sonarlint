/**
 * Boxes to lines: block flow with collapsing margins (none at the document edges), inline wrapping by terminal
 * cells, `pre` in a faint box, list markers, tables (columns between min- and max-content, a box-drawing grid,
 * stacked rows when even the minimum does not fit) and tab groups (all panels in order, or a tab bar with the
 * selected panel). Pure: the result carries the lines, highlight, link and tab regions in 0 based UTF-8 byte
 * columns, and the line of every anchor.
 */
import type { Box, BlockBox, Inline, InlineBox, InlineStyle, ListBox, PreBox, TableBox, TableCell, TableRow, TabsBox } from "./boxes";
import { Groups } from "./boxes";
import { cutByCells, displayWidth, spaces } from "./text";

/** A span of one line in UTF-16 offsets: a highlight group, a link target or a tab title. */
interface Mark {
    s: number;
    e: number;
    group?: string;
    link?: string;
    tab?: { group: string; index: number };
}

interface Line {
    text: string;
    marks: Mark[];
}

/** Laid out lines with the margins still to collapse above and below them. */
interface Frag {
    lines: Line[];
    mt: number;
    mb: number;
    anchors: Array<{ id: string; line: number }>;
}

export interface LayoutOptions {
    /** Width in cells. */
    width: number;
    /** Tab stop for tabs in preformatted text (default 8). */
    tabstop?: number;
    /** Every tab panel in order under its title instead of a tab bar with the selected panel. */
    allPanels?: boolean;
    /** Selected tab per group id; a group's `checked` tab when absent. */
    selected?: Record<string, number>;
}

export interface Highlight {
    lnum: number;
    colStart: number;
    colEnd: number;
    hlGroup: string;
}

export interface LinkRegion {
    lnum: number;
    colStart: number;
    colEnd: number;
    href: string;
}

/** Where a tab title is drawn. */
export interface TabRegion {
    group: string;
    index: number;
    lnum: number;
    colStart: number;
    colEnd: number;
}

export interface Layout {
    lines: string[];
    highlights: Highlight[];
    links: LinkRegion[];
    tabs: TabRegion[];
    /** The line of each anchor id (first occurrence). */
    anchors: Record<string, number>;
}

interface Ctx {
    opts: LayoutOptions;
    tabstop: number;
    /** Break words longer than the width (false measures min-content). */
    split: boolean;
    /** Nesting of tab bars (0 = top level). */
    tabDepth: number;
    /** Laid out table cells by width and split (a cell is measured several times; nested tables would be exponential). */
    cells: Map<TableCell, Map<string, Frag>>;
}

const UNBOUNDED = 1 << 20;
const RULE = "─";
const GRID = ["─", "│", "┌", "┐", "└", "┘", "├", "┤", "┬", "┴", "┼"];

function emptyFrag(mt: number = 0, mb: number = 0): Frag {
    return { lines: [], mt, mb, anchors: [] };
}

function line(text: string, marks: Mark[] = []): Line {
    return { text, marks };
}

function faint(text: string): Line {
    return line(text, text !== "" ? [{ s: 0, e: text.length, group: Groups.faint }] : []);
}

/** `prefix` + `l`, the prefix's own marks first. */
function prefixed(prefix: Line, l: Line): Line {
    const n = prefix.text.length;
    return line(prefix.text + l.text, prefix.marks.concat(l.marks.map((m: Mark): Mark => ({ ...m, s: m.s + n, e: m.e + n }))));
}

function concat(parts: Line[]): Line {
    return parts.reduce((acc: Line, p: Line): Line => prefixed(acc, p), line(""));
}

function padded(l: Line, cells: number): Line {
    return line(l.text + spaces(cells - displayWidth(l.text)), l.marks);
}

function fragWidth(f: Frag): number {
    return f.lines.reduce((m: number, l: Line): number => Math.max(m, displayWidth(l.text)), 0);
}

function mapLines(f: Frag, fn: (l: Line, i: number) => Line): Frag {
    return { ...f, lines: f.lines.map(fn) };
}

/** Stacks fragments: adjacent margins collapse to their maximum, the outer ones are passed on. */
function stack(frags: Frag[]): Frag {
    const out: Frag = emptyFrag();
    let pending = 0;
    let started = false;
    frags.forEach((f: Frag): void => {
        if (f.lines.length === 0) {
            pending = Math.max(pending, f.mt, f.mb);
            f.anchors.forEach((a): void => {
                out.anchors.push({ id: a.id, line: out.lines.length + (started ? pending : 0) });
            });
        } else {
            const gap = Math.max(pending, f.mt);
            if (started) {
                for (let i = 0; i < gap; i++) {
                    out.lines.push(line(""));
                }
            } else {
                out.mt = gap;
            }
            const base = out.lines.length;
            f.anchors.forEach((a): void => {
                out.anchors.push({ id: a.id, line: base + a.line });
            });
            f.lines.forEach((l: Line): void => {
                out.lines.push(l);
            });
            pending = f.mb;
            started = true;
        }
    });
    if (started) {
        out.mb = pending;
    } else {
        out.mt = pending;
        out.mb = pending;
    }
    return out;
}

/** Appends the lines of `f` to `out` behind `lead`, with its anchors. */
function append(out: Frag, f: Frag, lead: Line = line("")): void {
    const base = out.lines.length;
    f.anchors.forEach((a): void => {
        out.anchors.push({ id: a.id, line: base + a.line });
    });
    f.lines.forEach((l: Line): void => {
        out.lines.push(prefixed(lead, l));
    });
}

function withAnchors(f: Frag, ids: string[]): Frag {
    return ids.length === 0 ? f : { ...f, anchors: ids.map((id: string) => ({ id, line: 0 })).concat(f.anchors) };
}

function withMargins(f: Frag, mt: number, mb: number): Frag {
    return { ...f, mt: Math.max(f.mt, mt), mb: Math.max(f.mb, mb) };
}

/* ---------------------------------------------------------------- inline */

interface Flat {
    text: string;
    styles: number[];
    table: InlineStyle[];
    anchors: Array<{ pos: number; id: string }>;
}

function appendText(flat: Flat, text: string, style: number): void {
    flat.text += text;
    for (let i = 0; i < text.length; i++) {
        flat.styles.push(style);
    }
}

function trimEnd(flat: Flat): void {
    while (flat.text.endsWith(" ")) {
        flat.text = flat.text.slice(0, -1);
        flat.styles.pop();
    }
}

function expandTabs(text: string, column: number, tabstop: number): string {
    let col = column;
    let out = "";
    for (const ch of text) {
        if (ch === "\t") {
            const n = tabstop - (col % tabstop);
            out += spaces(n);
            col += n;
        } else if (ch === "\n") {
            out += ch;
            col = 0;
        } else {
            out += ch;
            col += displayWidth(ch);
        }
    }
    return out;
}

/** Inline items as one string (`\n` = forced break) with white space collapsed or kept. */
function flatten(box: InlineBox, tabstop: number): Flat {
    const flat: Flat = { text: "", styles: [], table: [], anchors: [] };
    const styleIndex = (s: InlineStyle): number => {
        let i = flat.table.indexOf(s);
        if (i < 0) {
            flat.table.push(s);
            i = flat.table.length - 1;
        }
        return i;
    };
    box.items.forEach((item: Inline): void => {
        if (item.kind === "anchor") {
            flat.anchors.push({ pos: flat.text.length, id: item.id });
        } else if (item.kind === "br") {
            if (!box.pre) {
                trimEnd(flat);
            }
            appendText(flat, "\n", -1);
        } else if (box.pre) {
            const lineStart = flat.text.lastIndexOf("\n") + 1;
            const text = expandTabs(item.text.replace(/\r\n?/g, "\n"), displayWidth(flat.text.slice(lineStart)), tabstop);
            appendText(flat, text, styleIndex(item.style));
        } else {
            let text = item.text.replace(/[ \t\n\r\f]+/g, " ");
            if (text.startsWith(" ") && (flat.text === "" || flat.text.endsWith(" ") || flat.text.endsWith("\n"))) {
                text = text.slice(1);
            }
            appendText(flat, text, styleIndex(item.style));
        }
    });
    if (!box.pre) {
        trimEnd(flat);
    }
    if (flat.text.endsWith("\n")) {
        flat.text = flat.text.slice(0, -1);
        flat.styles.pop();
    }
    return flat;
}

/** The marks of `flat` over `[start, end)`, relative to `start`. */
function marksOf(flat: Flat, start: number, end: number): Mark[] {
    const marks: Mark[] = [];
    let i = start;
    while (i < end) {
        const st = flat.styles[i];
        let j = i + 1;
        while (j < end && flat.styles[j] === st) {
            j++;
        }
        const style = st >= 0 ? flat.table[st] : undefined;
        if (style !== undefined) {
            style.groups.forEach((g: string): void => {
                marks.push({ s: i - start, e: j - start, group: g });
            });
            if (style.link !== undefined) {
                marks.push({ s: i - start, e: j - start, link: style.link });
            }
        }
        i = j;
    }
    return marks;
}

/** Line ranges `[start, end)` of one paragraph, greedy word wrap by cells. */
function wrapParagraph(text: string, offset: number, width: number, split: boolean): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const re = /[^ ]+/g;
    let start = -1;
    let end = -1;
    let used = 0;
    let m: RegExpExecArray | null = re.exec(text);
    while (m !== null) {
        const ws = offset + m.index;
        const we = ws + m[0].length;
        const w = displayWidth(m[0]);
        if (start >= 0 && used + 1 + w <= width) {
            end = we;
            used += 1 + w;
        } else {
            if (start >= 0) {
                ranges.push([start, end]);
            }
            if (split && w > width) {
                const cuts = cutByCells(m[0], width);
                let from = 0;
                cuts.slice(0, -1).forEach((c: number): void => {
                    ranges.push([ws + from, ws + c]);
                    from = c;
                });
                start = ws + from;
                end = we;
                used = displayWidth(m[0].slice(from));
            } else {
                start = ws;
                end = we;
                used = w;
            }
        }
        m = re.exec(text);
    }
    if (start >= 0) {
        ranges.push([start, end]);
    } else {
        ranges.push([offset, offset]);
    }
    return ranges;
}

function layoutInline(box: InlineBox, width: number, ctx: Ctx): Frag {
    const flat = flatten(box, ctx.tabstop);
    const ranges: Array<[number, number]> = [];
    if (flat.text !== "") {
        let offset = 0;
        flat.text.split("\n").forEach((para: string): void => {
            if (box.pre) {
                ranges.push([offset, offset + para.length]);
            } else {
                wrapParagraph(para, offset, Math.max(1, width), ctx.split).forEach((r) => ranges.push(r));
            }
            offset += para.length + 1;
        });
    }
    const lines: Line[] = ranges.map(([s, e]): Line => line(flat.text.slice(s, e).replace(/ /g, " "), marksOf(flat, s, e)));
    const anchors = flat.anchors.map((a) => {
        const idx = ranges.findIndex(([, e]): boolean => a.pos <= e);
        return { id: a.id, line: idx < 0 ? Math.max(0, ranges.length - 1) : idx };
    });
    return { lines, mt: 0, mb: 0, anchors };
}

/* ---------------------------------------------------------------- blocks */

function layoutFlow(boxes: Box[], width: number, ctx: Ctx): Frag {
    return stack(boxes.map((b: Box): Frag => layoutBox(b, width, ctx)));
}

function layoutBox(box: Box, width: number, ctx: Ctx): Frag {
    let f: Frag;
    if (box.kind === "inline") {
        f = layoutInline(box, width, ctx);
    } else if (box.kind === "block") {
        f = layoutBlock(box, width, ctx);
    } else if (box.kind === "pre") {
        f = layoutPre(box, width, ctx);
    } else if (box.kind === "hr") {
        f = withAnchors({ ...emptyFrag(box.mt, box.mb), lines: [faint(RULE.repeat(Math.max(1, width)))] }, box.anchors);
    } else if (box.kind === "list") {
        f = layoutList(box, width, ctx);
    } else if (box.kind === "table") {
        f = layoutTable(box, width, ctx);
    } else {
        f = layoutTabs(box, width, ctx);
    }
    return f;
}

function layoutBlock(box: BlockBox, width: number, ctx: Ctx): Frag {
    const bar = box.bar ? 2 : 0;
    const inner = layoutFlow(box.children, Math.max(1, width - box.ml - box.mr - bar), ctx);
    const lead: Line = box.bar ? prefixed(line(spaces(box.ml)), faint("│ ")) : line(spaces(box.ml));
    const f = lead.text === "" ? inner : mapLines(inner, (l: Line): Line => prefixed(lead, l));
    return withAnchors(withMargins(f, box.mt, box.mb), box.anchors);
}

function layoutPre(box: PreBox, width: number, ctx: Ctx): Frag {
    const inner = layoutFlow(box.children, UNBOUNDED, ctx);
    const lines = inner.lines.slice();
    while (lines.length > 0 && lines[lines.length - 1].text.trim() === "") {
        lines.pop();
    }
    let out: Line[] = lines;
    if (lines.length > 0 && width >= 4) {
        const left = faint("│ ");
        out = [faint(`┌${RULE.repeat(width - 2)}┐`)];
        lines.forEach((l: Line): void => {
            const fits = displayWidth(l.text) <= width - 4;
            out.push(fits ? concat([left, padded(l, width - 4), faint(" │")]) : prefixed(left, l));
        });
        out.push(faint(`└${RULE.repeat(width - 2)}┘`));
    }
    const shift = out === lines ? 0 : 1;
    const anchors = inner.anchors.map((a) => ({ id: a.id, line: Math.min(a.line + shift, Math.max(0, out.length - 1)) }));
    return withAnchors({ lines: out, mt: box.mt, mb: box.mb, anchors }, box.anchors);
}

function layoutList(box: ListBox, width: number, ctx: Ctx): Frag {
    const pad = box.items.reduce((m: number, it): number => Math.max(m, displayWidth(it.marker)), 3);
    const frags = box.items.map((it): Frag => {
        let f = layoutFlow(it.children, Math.max(1, width - pad), ctx);
        if (f.lines.length === 0 && it.marker !== "") {
            f = { ...f, lines: [line("")] };
        }
        const marker = line(spaces(pad - displayWidth(it.marker)) + it.marker);
        const indent = line(spaces(pad));
        return withAnchors(mapLines(f, (l: Line, i: number): Line => prefixed(i === 0 ? marker : indent, l)), it.anchors);
    });
    return withAnchors(withMargins(stack(frags), box.mt, box.mb), box.anchors);
}

/* ---------------------------------------------------------------- tables */

interface GridCell {
    cell: TableCell;
    col: number;
    span: number;
}

interface GridRow {
    header: boolean;
    cells: GridCell[];
}

function buildGrid(rows: TableRow[]): { rows: GridRow[]; ncols: number } {
    let ncols = 0;
    const grid = rows.map((r: TableRow): GridRow => {
        let col = 0;
        const cells = r.cells.map((cell: TableCell): GridCell => {
            const placed = { cell, col, span: Math.max(1, cell.span) };
            col += placed.span;
            return placed;
        });
        ncols = Math.max(ncols, col);
        return { header: r.header, cells };
    });
    return { rows: grid, ncols: Math.max(1, ncols) };
}

/** A cell at `width` cells (padding 0 1 included), edge margins dropped; laid out once per width and split. */
function cellFrag(cell: TableCell, width: number, ctx: Ctx, split: boolean): Frag {
    const key = `${width}:${split}`;
    const byKey = ctx.cells.get(cell) ?? new Map<string, Frag>();
    ctx.cells.set(cell, byKey);
    let f = byKey.get(key);
    if (f === undefined) {
        const inner = layoutFlow(cell.children, Math.max(1, width - 2), { ...ctx, split });
        f = { ...mapLines(inner, (l: Line): Line => prefixed(line(" "), l)), mt: 0, mb: 0 };
        byKey.set(key, f);
    }
    return f;
}

function distribute(mins: number[], maxs: number[], avail: number): number[] {
    const widths = mins.slice();
    let left = avail - mins.reduce((a, b) => a + b, 0);
    const slack = maxs.map((m: number, i: number): number => m - mins[i]);
    const total = slack.reduce((a, b) => a + b, 0);
    if (total > 0) {
        const shares = slack.map((s: number): number => Math.floor((s * left) / total));
        shares.forEach((s: number, i: number): void => {
            widths[i] += s;
        });
        left -= shares.reduce((a, b) => a + b, 0);
        widths.forEach((w: number, i: number): void => {
            if (left > 0 && w < maxs[i]) {
                widths[i] += 1;
                left -= 1;
            }
        });
    }
    return widths;
}

function spanWidth(widths: readonly number[], c: GridCell): number {
    return widths.slice(c.col, c.col + c.span).reduce((a, b) => a + b, 0) + (c.span - 1);
}

/** Column widths (padding included) that fit `avail`, or undefined. */
function fitColumns(grid: { rows: GridRow[]; ncols: number }, avail: number, ctx: Ctx): number[] | undefined {
    const mins = new Array<number>(grid.ncols).fill(1);
    const maxs = new Array<number>(grid.ncols).fill(1);
    const measured: Array<{ c: GridCell; max: number }> = [];
    grid.rows.forEach((r: GridRow): void => {
        r.cells.forEach((c: GridCell): void => {
            const min = fragWidth(cellFrag(c.cell, 3, ctx, false)) + 1;
            const max = Math.max(min, fragWidth(cellFrag(c.cell, Math.max(3, avail), ctx, true)) + 1);
            measured.push({ c, max });
            if (c.span === 1) {
                mins[c.col] = Math.max(mins[c.col], min);
                maxs[c.col] = Math.max(maxs[c.col], max);
            }
        });
    });
    const sumMin = mins.reduce((a, b) => a + b, 0);
    const sumMax = maxs.reduce((a, b) => a + b, 0);
    let widths: number[] | undefined;
    if (sumMax <= avail) {
        widths = maxs;
    } else if (sumMin <= avail) {
        widths = distribute(mins, maxs, avail);
    }
    if (widths !== undefined) {
        const fixed = widths;
        measured
            .filter((m): boolean => m.c.span > 1)
            .forEach((m): void => {
                const missing = Math.min(m.max, avail) - spanWidth(fixed, m.c);
                if (missing > 0) {
                    fixed[Math.min(grid.ncols, m.c.col + m.c.span) - 1] += missing;
                }
            });
        widths = fixed.reduce((a, b) => a + b, 0) <= avail ? fixed : undefined;
    }
    return widths;
}

/** The column boundaries where `row` draws a bar (none inside a spanning cell or past its last cell). */
function edges(row: GridRow | undefined, ncols: number): Set<number> {
    const out: Set<number> = new Set();
    if (row !== undefined) {
        const last = row.cells[row.cells.length - 1];
        const end = last !== undefined ? last.col + last.span : 0;
        for (let c = 1; c < Math.min(ncols, end + 1); c++) {
            if (!row.cells.some((p: GridCell): boolean => p.col < c && c < p.col + p.span)) {
                out.add(c);
            }
        }
    }
    return out;
}

function borderLine(widths: readonly number[], above: GridRow | undefined, below: GridRow | undefined): string {
    const up = edges(above, widths.length);
    const down = edges(below, widths.length);
    const g = GRID;
    let text = above === undefined ? g[2] : below === undefined ? g[4] : g[6];
    widths.forEach((w: number, c: number): void => {
        if (c > 0) {
            const u = up.has(c);
            const d = down.has(c);
            text += u && d ? g[10] : u ? g[9] : d ? g[8] : g[0];
        }
        text += g[0].repeat(w);
    });
    return text + (above === undefined ? g[3] : below === undefined ? g[5] : g[7]);
}

function placeGrid(grid: { rows: GridRow[]; ncols: number }, widths: number[], ctx: Ctx): Frag {
    const total = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) + 2;
    const frags = grid.rows.map((r: GridRow): Frag[] => r.cells.map((c: GridCell): Frag => cellFrag(c.cell, spanWidth(widths, c), ctx, true)));
    const heights = frags.map((fs: Frag[]): number => fs.reduce((acc: number, f: Frag): number => Math.max(acc, f.lines.length), 1));
    const tall = grid.rows.some((r: GridRow, i: number): boolean => !r.header && heights[i] > 1);
    const out: Frag = { ...emptyFrag(), lines: [faint(borderLine(widths, undefined, grid.rows[0]))] };
    const bar = faint(GRID[1]);
    grid.rows.forEach((r: GridRow, i: number): void => {
        const prev = i > 0 ? grid.rows[i - 1] : undefined;
        if (prev !== undefined && (prev.header !== r.header || (tall && !r.header))) {
            out.lines.push(faint(borderLine(widths, prev, r)));
        }
        const top = out.lines.length;
        frags[i].forEach((f: Frag): void => {
            f.anchors.forEach((a): void => {
                out.anchors.push({ id: a.id, line: top + a.line });
            });
        });
        for (let k = 0; k < heights[i]; k++) {
            const parts: Line[] = [bar];
            r.cells.forEach((c: GridCell, j: number): void => {
                const l = frags[i][j].lines[k] ?? line("");
                parts.push(padded(l, spanWidth(widths, c)), bar);
            });
            const row = concat(parts);
            const used = displayWidth(row.text);
            out.lines.push(used < total ? concat([row, line(spaces(total - used - 1)), bar]) : row);
        }
    });
    out.lines.push(faint(borderLine(widths, grid.rows[grid.rows.length - 1], undefined)));
    return out;
}

/** The first header row when it can label every body cell below it in stacked mode (span 1, a body cell per column). */
function labelRow(rows: GridRow[]): GridRow | undefined {
    const head = rows.find((r: GridRow): boolean => r.header);
    const body = rows.filter((r: GridRow): boolean => !r.header);
    const labels = (h: GridCell): boolean => h.span === 1 && body.some((r: GridRow): boolean => r.cells.some((c: GridCell): boolean => c.col === h.col && c.span === 1));
    return head !== undefined && head.cells.every(labels) ? head : undefined;
}

/** Rows one after another, ruled apart; body cells under their header label, other rows as they are. */
function placeStacked(grid: { rows: GridRow[]; ncols: number }, width: number, ctx: Ctx): Frag {
    const labels = labelRow(grid.rows);
    const out: Frag = emptyFrag();
    grid.rows
        .filter((r: GridRow): boolean => r !== labels)
        .forEach((r: GridRow, i: number): void => {
            if (i > 0) {
                out.lines.push(faint(RULE.repeat(Math.max(1, width))));
            }
            r.cells.forEach((c: GridCell): void => {
                const label = labels !== undefined && !r.header ? labels.cells.find((h: GridCell): boolean => h.col === c.col && c.span === 1) : undefined;
                if (label !== undefined) {
                    append(out, cellFrag(label.cell, width, ctx, true));
                }
                const indent = label !== undefined ? 2 : 0;
                append(out, cellFrag(c.cell, width - indent, ctx, true), line(spaces(indent)));
            });
        });
    return out;
}

/** Captions centred over the width, then the grid (or the stacked rows when the columns do not fit). */
function layoutTable(box: TableBox, width: number, ctx: Ctx): Frag {
    const out: Frag = emptyFrag(box.mt, box.mb);
    box.captions.forEach((boxes: Box[]): void => {
        const f = layoutFlow(boxes, width, ctx);
        append(out, { ...f, lines: [] });
        f.lines.forEach((l: Line): void => {
            out.lines.push(prefixed(line(spaces(Math.floor((width - displayWidth(l.text)) / 2))), l));
        });
    });
    const grid = buildGrid(box.rows);
    const avail = width - 2 - (grid.ncols - 1);
    if (grid.rows.length > 0) {
        const widths = avail > 0 ? fitColumns(grid, avail, ctx) : undefined;
        append(out, widths !== undefined ? placeGrid(grid, widths, ctx) : placeStacked(grid, width, ctx));
    }
    return withAnchors(out, box.anchors);
}

/* ---------------------------------------------------------------- tabs */

function titleLine(title: InlineBox, ctx: Ctx): Line {
    const f = layoutInline(title, UNBOUNDED, { ...ctx, split: false });
    return line(f.lines.map((l: Line) => l.text).join(" ").trim(), f.lines.length === 1 ? f.lines[0].marks : []);
}

function tabMark(l: Line, group: string, index: number, at: number): Line {
    return { ...l, marks: l.marks.concat([{ s: at, e: at + l.text.length, tab: { group, index } }]) };
}

/** Every panel in order, each under its title as a heading-like line. */
function layoutAllPanels(box: TabsBox, width: number, ctx: Ctx): Frag {
    const frags: Frag[] = [];
    box.titles.forEach((title: InlineBox, i: number): void => {
        const t = titleLine(title, ctx);
        const titled = tabMark(line(t.text, t.marks.concat(t.text !== "" ? [{ s: 0, e: t.text.length, group: Groups.title }] : [])), box.group, i, 0);
        frags.push({ lines: [titled], mt: 1, mb: 1, anchors: [] });
        frags.push(layoutFlow(box.panels[i], width, ctx));
    });
    return stack(frags);
}

/** A tab bar (the selected title boxed at the top level) over a rule, then the selected panel indented by one. */
function layoutSelected(box: TabsBox, width: number, ctx: Ctx): Frag {
    const chosen = ctx.opts.selected !== undefined && ctx.opts.selected[box.group] !== undefined ? ctx.opts.selected[box.group] : box.checked;
    const selected = Math.max(0, Math.min(box.titles.length - 1, chosen));
    const boxed = ctx.tabDepth === 0;
    const parts: Line[] = [];
    let top = "";
    box.titles.forEach((title: InlineBox, i: number): void => {
        const t = titleLine(title, ctx);
        const sep = i > 0 ? line(" ") : line("");
        const label = tabMark(i === selected ? line(t.text, t.marks.concat([{ s: 0, e: t.text.length, group: Groups.title }])) : t, box.group, i, 0);
        if (i === selected && boxed) {
            top = spaces(displayWidth(concat(parts.concat([sep])).text)) + `┌${RULE.repeat(displayWidth(t.text) + 2)}┐`;
            parts.push(sep, faint("│ "), label, faint(" │"));
        } else {
            parts.push(sep, line(" "), label, line(" "));
        }
    });
    const bar = concat(parts);
    const lines: Line[] = top !== "" ? [faint(top), bar] : [bar];
    lines.push(faint(RULE.repeat(Math.max(1, width))));
    const panel = layoutFlow(box.panels[selected] ?? [], Math.max(1, width - 2), { ...ctx, tabDepth: ctx.tabDepth + 1 });
    const inner: Line[] = [];
    for (let i = 0; i < panel.mt && panel.lines.length > 0; i++) {
        inner.push(line(""));
    }
    panel.lines.forEach((l: Line): void => {
        inner.push(prefixed(line(" "), l));
    });
    const base = lines.length + inner.length - panel.lines.length;
    const anchors = panel.anchors.map((a) => ({ id: a.id, line: base + a.line }));
    return withAnchors({ lines: lines.concat(inner), mt: box.mt, mb: Math.max(box.mb, panel.mb), anchors }, box.anchors);
}

function layoutTabs(box: TabsBox, width: number, ctx: Ctx): Frag {
    return ctx.opts.allPanels === true ? layoutAllPanels(box, width, ctx) : layoutSelected(box, width, ctx);
}

/* ---------------------------------------------------------------- result */

function utf8(s: string): number {
    return Buffer.byteLength(s, "utf8");
}

/** Lays out `boxes` at `opts.width`; never throws on any box tree. */
export function layout(boxes: Box[], opts: LayoutOptions): Layout {
    const width = Math.max(1, Math.floor(opts.width));
    const ctx: Ctx = { opts, tabstop: Math.max(1, opts.tabstop ?? 8), split: true, tabDepth: 0, cells: new Map() };
    const frag = layoutFlow(boxes, width, ctx);
    const out: Layout = { lines: [], highlights: [], links: [], tabs: [], anchors: {} };
    frag.lines.forEach((l: Line, lnum: number): void => {
        const text = l.text.replace(/\s+$/, "");
        out.lines.push(text);
        l.marks.forEach((m: Mark): void => {
            const s = Math.min(m.s, text.length);
            const e = Math.min(m.e, text.length);
            if (e > s) {
                const colStart = utf8(text.slice(0, s));
                const colEnd = utf8(text.slice(0, e));
                if (m.group !== undefined) {
                    out.highlights.push({ lnum, colStart, colEnd, hlGroup: m.group });
                }
                if (m.link !== undefined) {
                    out.links.push({ lnum, colStart, colEnd, href: m.link });
                }
                if (m.tab !== undefined) {
                    out.tabs.push({ group: m.tab.group, index: m.tab.index, lnum, colStart, colEnd });
                }
            }
        });
    });
    frag.anchors.forEach((a): void => {
        if (out.anchors[a.id] === undefined) {
            out.anchors[a.id] = Math.max(0, Math.min(a.line, out.lines.length - 1));
        }
    });
    return out;
}
