/**
 * Small fallback renderer: turns the adapters' HTML (ViewInput) into plain text lines plus highlights, for
 * when the optional htmlview extension is not installed. Pure `renderSimple`, float glue in `showSimple`.
 * Highlight columns are 0 based UTF-8 byte offsets, which is what coc (Vim and Neovim) expects.
 */
import type { FloatFactory } from "coc.nvim";
import { HTMLElement, Node, parse } from "node-html-parser";
import type { ViewInput } from "../rules/markup";

export interface SimpleHighlight {
    lnum: number;
    colStart: number;
    colEnd: number;
    hlGroup: string;
}
export interface SimpleResult {
    lines: string[];
    highlights: SimpleHighlight[];
}

const DROP = new Set(["script", "style", "input", "button", "head", "svg", "select", "textarea", "template"]);
const INLINE = new Set(["a", "abbr", "b", "br", "code", "em", "font", "i", "img", "kbd", "label", "mark", "small", "span", "strong", "sub", "sup", "u"]);

/** Terminal cell width of a code point: 0 for combining and zero width, 2 for CJK and emoji, else 1. */
function cpWidth(cp: number): number {
    const inRange = (ranges: number[][]) => ranges.some(([a, b]) => cp >= a && cp <= b);
    let w = 1;
    if (inRange([[0x200b, 0x200f], [0x300, 0x36f], [0xfe00, 0xfe0f], [0x2060, 0x2064]])) {
        w = 0;
    } else if (inRange([[0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd]])) {
        w = 2;
    }
    return w;
}
export function displayWidth(s: string): number {
    let w = 0;
    for (const ch of s) {
        w += cpWidth(ch.codePointAt(0)!);
    }
    return w;
}
const bytes = (s: string) => Buffer.byteLength(s);

interface Run {
    s: number;
    e: number;
    g: string;
}
/** Inline content flattened to one string (`\n` = line break) with a highlight group per UTF-16 unit. */
interface Flat {
    text: string;
    groups: (string | undefined)[];
}

function flatten(nodes: Node[], g: string | undefined, out: Flat): void {
    const add = (t: string, grp: string | undefined) => {
        out.text += t;
        for (let i = 0; i < t.length; i++) {
            out.groups.push(grp);
        }
    };
    for (const n of nodes) {
        if (!(n instanceof HTMLElement)) {
            add(n.text.replace(/\s+/g, " "), g);
        } else if (!DROP.has(n.tagName.toLowerCase())) {
            const tag = n.tagName.toLowerCase();
            if (tag === "br") {
                add("\n", g);
            } else if (tag === "code" || tag === "kbd") {
                flatten([...n.childNodes], "Special", out);
            } else if (tag === "a") {
                flatten([...n.childNodes], "Underlined", out);
                const href = n.getAttribute("href") ?? "";
                if (href && !href.startsWith("#") && href !== n.text.trim()) {
                    add(` (${href})`, "Comment");
                }
            } else {
                flatten([...n.childNodes], g, out);
            }
        }
    }
}

/** Greedy word wrap of a Flat to `width` cells; overlong words stay whole. Returns lines with highlight runs. */
function wrap(flat: Flat, width: number): { text: string; runs: Run[] }[] {
    const result: { text: string; runs: Run[] }[] = [];
    let idx = 0;
    for (const raw of flat.text.split("\n")) {
        const start = idx;
        idx += raw.length + 1;
        let cur = "";
        let curGroups: (string | undefined)[] = [];
        const push = () => {
            const text = cur.replace(/ +$/, "");
            const runs: Run[] = [];
            for (let i = 0; i < text.length; i++) {
                const g = curGroups[i];
                const last = runs[runs.length - 1];
                if (g && last && last.g === g && last.e === i) {
                    last.e = i + 1;
                } else if (g) {
                    runs.push({ s: i, e: i + 1, g });
                }
            }
            result.push({ text, runs });
            cur = "";
            curGroups = [];
        };
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(raw))) {
            const word = m[0];
            if (cur && displayWidth(cur) + 1 + displayWidth(word) > width) {
                push();
            }
            if (cur) {
                cur += " ";
                curGroups.push(undefined);
            }
            cur += word;
            for (let i = 0; i < word.length; i++) {
                curGroups.push(flat.groups[start + m.index + i]);
            }
        }
        push();
    }
    return result;
}

export function renderSimple(html: string, opts: { width: number }): SimpleResult {
    const lines: string[] = [];
    const highlights: SimpleHighlight[] = [];
    let pend: string | null = null; // list marker for the next emitted line
    const root = parse(html);

    const emit = (pre: string, text: string, runs: Run[]) => {
        const prefix = pend ?? pre;
        pend = null;
        const lnum = lines.length;
        lines.push(prefix + text);
        for (const r of runs) {
            highlights.push({ lnum, colStart: bytes(prefix + text.slice(0, r.s)), colEnd: bytes(prefix + text.slice(0, r.e)), hlGroup: r.g });
        }
    };
    const gap = (pre: string) => {
        if (pend === null && lines.length && lines[lines.length - 1].trim() !== "") {
            lines.push(pre.trimEnd());
        }
    };
    const text = (nodes: Node[], pre: string, g?: string, lead = "") => {
        const flat: Flat = { text: "", groups: [] };
        flatten(nodes, g, flat);
        const lead0 = flat.text.length - flat.text.trimStart().length;
        const trimmed = flat.text.trim();
        if (trimmed) {
            flat.groups = [...[...lead].map(() => g), ...flat.groups.slice(lead0, lead0 + trimmed.length)];
            flat.text = lead + trimmed;
            gap(pre);
            const out = wrap(flat, Math.max(10, opts.width - displayWidth(pre)));
            for (const l of out) {
                emit(pre, l.text, g && l.text ? [{ s: 0, e: l.text.length, g }] : l.runs);
            }
        }
    };

    const list = (el: HTMLElement, pre: string, depth: number) => {
        const ordered = el.tagName.toLowerCase() === "ol";
        let n = 0;
        for (const li of el.childNodes) {
            if (li instanceof HTMLElement && li.tagName.toLowerCase() === "li") {
                n++;
                const marker = ordered ? `${n}. ` : "• ";
                const inner = pre + " ".repeat(displayWidth(marker));
                pend = pre + marker;
                walk([...li.childNodes], inner, depth + 1);
                if (pend !== null) {
                    emit(pre, "", []);
                }
            }
        }
    };

    const walk = (nodes: Node[], pre: string, depth: number) => {
        let buf: Node[] = [];
        const flush = () => {
            text(buf, pre);
            buf = [];
        };
        for (const n of nodes) {
            const tag = n instanceof HTMLElement ? n.tagName.toLowerCase() : "";
            if (!(n instanceof HTMLElement) || INLINE.has(tag)) {
                if (!(n instanceof HTMLElement) || !DROP.has(tag)) {
                    buf.push(n);
                }
            } else if (!DROP.has(tag)) {
                flush();
                block(n, tag, pre, depth);
            }
        }
        flush();
    };

    const block = (el: HTMLElement, tag: string, pre: string, depth: number) => {
        if (/^h[1-6]$/.test(tag)) {
            text([...el.childNodes], pre, "Title", "#".repeat(Number(tag[1])) + " ");
        } else if (tag === "p") {
            text([...el.childNodes], pre);
        } else if (tag === "ul" || tag === "ol") {
            if (depth === 0) {
                gap(pre);
            }
            list(el, pre, depth);
        } else if (tag === "pre") {
            gap(pre);
            const code = el.text.replace(/^\r?\n/, "").replace(/\s+$/, "");
            for (const l of code.split("\n")) {
                const body = l.replace(/\s+$/, "");
                emit(pre + "  ", body, body ? [{ s: 0, e: body.length, g: "String" }] : []);
            }
        } else if (tag === "hr") {
            gap(pre);
            const rule = "─".repeat(Math.max(3, Math.min(opts.width - displayWidth(pre), 40)));
            emit(pre, rule, [{ s: 0, e: rule.length, g: "Comment" }]);
        } else if (tag === "blockquote") {
            gap(pre);
            walk([...el.childNodes], pre + "│ ", depth);
        } else if (tag === "table") {
            gap(pre);
            for (const tr of el.querySelectorAll("tr")) {
                const cells = tr.childNodes.filter((c): c is HTMLElement => c instanceof HTMLElement && /^t[hd]$/.test(c.tagName.toLowerCase()));
                const flat: Flat = { text: "", groups: [] };
                const isHead = cells.length > 0 && cells.every((c) => c.tagName.toLowerCase() === "th");
                cells.forEach((c, i) => {
                    const part: Flat = { text: "", groups: [] };
                    flatten([...c.childNodes], isHead ? "Title" : undefined, part);
                    const t = part.text.replace(/\n/g, " ").trim();
                    const lead = part.text.length - part.text.trimStart().length;
                    flat.text += (i ? " │ " : "") + t;
                    flat.groups.push(...(i ? [undefined, "Comment", undefined] : []), ...part.groups.slice(lead, lead + t.length));
                });
                const runs: Run[] = [];
                flat.groups.forEach((g, i) => g && runs.push({ s: i, e: i + 1, g }));
                emit(pre, flat.text, runs);
            }
        } else {
            walk([...el.childNodes], pre, depth);
        }
    };

    walk([...root.childNodes], "", 0);
    while (lines.length && lines[lines.length - 1].trim() === "") {
        lines.pop();
    }
    return { lines, highlights: highlights.filter((h) => h.lnum < lines.length) };
}

let factory: FloatFactory | undefined;

/** Shows a view in a focusable coc float that stays open until closed (Vim and Neovim). */
export async function showSimple(input: ViewInput): Promise<void> {
    const coc = await import("coc.nvim"); // lazy: renderSimple stays usable without the coc runtime
    const cols = coc.workspace.env.columns;
    const rows = coc.workspace.env.lines;
    const width = Math.max(30, Math.min(100, cols - 12));
    const { lines, highlights } = renderSimple(input.html, { width });
    if (!factory) {
        factory = coc.window.createFloatFactory({});
    }
    const widest = lines.reduce((m, l) => Math.max(m, displayWidth(l)), 0);
    await factory.show([{ filetype: "txt", content: lines.join("\n"), highlights: highlights.map((h) => ({ ...h })) }], {
        title: input.title,
        focusable: true,
        autoHide: false,
        close: true,
        border: [1, 1, 1, 1],
        rounded: true,
        maxWidth: Math.min(widest + 2, cols - 6),
        maxHeight: Math.max(5, rows - 8),
        modes: ["n"],
    });
}
