/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { nvim, type HighlightItem } from "coc.nvim";
import * as fs from "fs/promises";
import juice from "juice";
import * as css from "css";
import { Node as HNode, HTMLElement, parse, TextNode } from "node-html-parser";
import * as path from "path";
import * as util from "./util";

/* ===========================
   Types & Exports
   =========================== */
export type RenderResult = { text: string; highlights: HighlightItem[] };
export type RenderWithCssResult = { text: string; highlights: HighlightItem[] };

/* ===========================
   Constants
   =========================== */
const ICON = {
    h1: "◉",
    h2: "◆",
    h3: "▸",
    h4: "▹",
    h5: "‣",
    h6: "•",
    table: "⌗",
    link: "🔗"
};

const DIFF_CONTAINER_CLASS = "code-difference-container";
const DIFF_ADDED_CLASS = "code-added";
const DIFF_REMOVED_CLASS = "code-removed";
const CODE_BLOCK_BACKGROUND = "CodeBackground";

const BLOCK_TAGS = new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "canvas",
    "dd",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "noscript",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tfoot",
    "thead",
    "tbody",
    "tr",
    "ul",
    "video"
]);

/* ===========================
   Small Utils
   =========================== */
const isElement = (n: HNode): n is HTMLElement => (n as any).nodeType === 1 && !!(n as any).rawTagName;
const isText = (n: HNode): n is TextNode => (n as any).nodeType === 3;
const toTag = (el: HTMLElement) => (el.tagName || "").toLowerCase();
const clsList = (el: HTMLElement): string[] => (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
const repeat = (s: string, n: number) => new Array(n + 1).join(s);
const normalizeClass = (c: string) => c.replace(/\W/g, "_");
const groupForClass = (c: string) => `HtmlClass_${normalizeClass(c)}`;

const fromCodePointSafe = (cp: number): string => {
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
    try {
        return String.fromCodePoint(cp);
    } catch {
        return "";
    }
};

const decodeEntitiesBasic = (s: string) => {
    if (!s) return s;
    let out = s
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/(?:&#39;|&apos;)/g, "'");
    // numeric hex/dec entities
    out = out.replace(/&#x([\da-fA-F]+);/g, (_m, hex) => fromCodePointSafe(parseInt(hex, 16)));
    out = out.replace(/&#(\d+);/g, (_m, dec) => fromCodePointSafe(parseInt(dec, 10)));
    return out;
};

const normalizeInline = (s: string) => s.replace(/\s+/g, " ");

type Ctx = { inPre: boolean; olIndex?: number; ambient?: string[] };
type AmbientMaps = { classToGroup: Record<string, string> };
let STYLE_AMBIENT: AmbientMaps = { classToGroup: {} };

export function setStyleDrivenClassGroups(map: Record<string, string>) {
    STYLE_AMBIENT.classToGroup = map || {};
}

const combineGroups = (g?: string, ambient?: string[]): string | string[] | undefined =>
    ambient?.length ? [...ambient, ...(g ? [g] : [])] : g;

function isInlineDisplayDiv(el: HTMLElement): boolean {
    const disp = parseInlineStyle(el.getAttribute("style"))["display"];
    return !!disp && /^inline(-block)?$/i.test(disp);
}

function hasBlockChild(el: HTMLElement): boolean {
    for (const n of el.childNodes) {
        if (!isElement(n)) continue;
        const tag = toTag(n);
        if (BLOCK_TAGS.has(tag)) return true;
        if (tag === "div" && !isInlineDisplayDiv(n)) return true;
    }
    return false;
}

function hasNonWhitespaceText(el: HTMLElement): boolean {
    for (const n of el.childNodes) {
        if (isText(n) && /\S/.test(n.rawText)) return true;
    }
    return false;
}

/* ===========================
   Builder (text + highlights)
   =========================== */
class TextAndHiBuilder {
    public readonly highlights: HighlightItem[] = [];
    public line = 0;
    public col = 0;
    public byteCol = 0;

    private readonly _bgRects: Array<{ start: number; end: number; group: string; width?: number }> = [];
    private readonly _buf: string[] = [];

    private _byteLen(s: string) {
        return Buffer.byteLength(s, "utf8");
    }

    append(text: string, hlGroup?: string | string[]) {
        if (!text) return;
        const groups = Array.isArray(hlGroup) ? hlGroup : hlGroup ? [hlGroup] : [];
        const parts = text.split("\n");
        for (let i = 0; i < parts.length; i++) {
            const seg = parts[i];
            if (groups.length && seg.length > 0) {
                const segBytes = this._byteLen(seg);
                for (const g of groups) {
                    this.highlights.push({
                        hlGroup: g,
                        lnum: this.line,
                        colStart: this.byteCol,
                        colEnd: this.byteCol + segBytes
                    });
                }
            }
            this._buf.push(seg);
            this.col += seg.length;
            this.byteCol += this._byteLen(seg);

            if (i < parts.length - 1) {
                this._buf.push("\n");
                this.line += 1;
                this.col = 0;
                this.byteCol = 0;
            }
        }
    }

    appendLine(s: string, hlGroup?: string | string[]) {
        this.append(s, hlGroup);
        this.append("\n");
    }

    /** Mark a rectangular background (inclusive) for lines [start..end] at optional fixed byte width. */
    markBgRect(startLine: number, endLineInclusive: number, group: string, widthBytes?: number) {
        if (endLineInclusive >= startLine) this._bgRects.push({ start: startLine, end: endLineInclusive, group, width: widthBytes });
    }

    /** Build background highlights after final text is known. */
    buildBackgroundHighlights(fullText: string): HighlightItem[] {
        const lines = fullText.split("\n");
        const out: HighlightItem[] = [];
        for (const { start, end, group, width } of this._bgRects) {
            const to = Math.min(end, lines.length - 1);
            // compute width if not provided
            let w = width ?? 0;
            if (w === 0) {
                for (let l = Math.max(0, start); l <= to; l++) {
                    const bl = Buffer.byteLength(lines[l], "utf8");
                    if (bl > w) w = bl;
                }
            }
            for (let l = Math.max(0, start); l <= to; l++) {
                out.push({ hlGroup: group, lnum: l, colStart: 0, colEnd: w });
            }
        }
        return out;
    }

    text(): string {
        return this._buf.join("");
    }
}

/* ===========================
   CSS color helpers
   =========================== */
function stripImportant(v?: string): string | undefined {
    if (!v) return v;
    return v.replace(/\s*!important\s*$/i, "").trim();
}

function resolveVarChain(v: string | undefined, vars: Map<string, string>): string | undefined {
    if (!v) return v;
    let out = v.trim();
    const re = /var\((--[a-z\d\-_]+)\)/i;
    let guard = 5;
    while (guard-- > 0) {
        const m = RegExp(re).exec(out);
        if (!m) break;
        const rep = vars.get(m[1]);
        if (!rep) break;
        out = out.replace(m[0], rep.trim());
    }
    return out;
}

function resolveCssVarValue(v: string | undefined, vars: Map<string, string>): string | undefined {
    if (!v) return v;
    const m = RegExp(/^var\((--[^,)]+)\)/).exec(v);
    if (!m) return v;
    const raw = vars.get(m[1]);
    return raw ? raw.trim() : v;
}

function hexFromRgb(r: number, g: number, b: number): string {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return (
        "#" +
        [clamp(r), clamp(g), clamp(b)]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase()
    );
}

function parseHexToRgb(v: string): { r: number; g: number; b: number; a: number } | null {
    const m = RegExp(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i).exec(v);
    if (!m) return null;
    const hex = m[1];
    if (hex.length === 3) {
        const [r, g, b] = hex.split("");
        return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16), a: 255 };
    }
    if (hex.length === 4) {
        const [r, g, b, a] = hex.split("");
        return {
            r: parseInt(r + r, 16),
            g: parseInt(g + g, 16),
            b: parseInt(b + b, 16),
            a: parseInt(a + a, 16)
        };
    }
    if (hex.length === 6) {
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
            a: 255
        };
    }
    // 8 = RRGGBBAA
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16)
    };
}

function parseRgbFunc(v: string): { r: number; g: number; b: number; a: number } | null {
    const m = RegExp(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i).exec(v);
    if (!m) return null;
    const r = parseFloat(m[1]);
    const g = parseFloat(m[2]);
    const b = parseFloat(m[3]);
    const a = m[4] != null ? Math.max(0, Math.min(1, parseFloat(m[4]))) : 1;
    return { r, g, b, a: Math.round(a * 255) };
}

function parseHslFunc(v: string): { r: number; g: number; b: number; a: number } | null {
    const m = RegExp(/^hsla?\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%(?:\s*,\s*([0-9.]+))?\s*\)$/i).exec(v);
    if (!m) return null;
    let h = ((parseFloat(m[1]) % 360) + 360) % 360;
    const s = Math.max(0, Math.min(100, parseFloat(m[2]))) / 100;
    const l = Math.max(0, Math.min(100, parseFloat(m[3]))) / 100;
    const a = m[4] != null ? Math.max(0, Math.min(1, parseFloat(m[4]))) : 1;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m0 = l - c / 2;
    let r1 = 0,
        g1 = 0,
        b1 = 0;
    if (h < 60) {
        r1 = c;
        g1 = x;
    } else if (h < 120) {
        r1 = x;
        g1 = c;
    } else if (h < 180) {
        g1 = c;
        b1 = x;
    } else if (h < 240) {
        g1 = x;
        b1 = c;
    } else if (h < 300) {
        r1 = x;
        b1 = c;
    } else {
        r1 = c;
        b1 = x;
    }

    const r = Math.round((r1 + m0) * 255);
    const g = Math.round((g1 + m0) * 255);
    const b = Math.round((b1 + m0) * 255);
    return { r, g, b, a: Math.round(a * 255) };
}

function normalizeCssColorToHex(v?: string, vars?: Map<string, string>): string | undefined {
    if (!v) return undefined;
    v = stripImportant(v);
    if (!v) return undefined;
    if (vars) v = resolveVarChain(v, vars) ?? v;
    if (/^(transparent|inherit|initial|unset|currentcolor)$/i.test(v)) return undefined;

    const hex = parseHexToRgb(v);
    if (hex) {
        if (hex.a === 0) return undefined;
        return hexFromRgb(hex.r, hex.g, hex.b);
    }

    const rgba = parseRgbFunc(v);
    if (rgba) {
        if (rgba.a === 0) return undefined;
        return hexFromRgb(rgba.r, rgba.g, rgba.b);
    }

    const hsla = parseHslFunc(v);
    if (hsla) {
        if (hsla.a === 0) return undefined;
        return hexFromRgb(hsla.r, hsla.g, hsla.b);
    }

    return undefined;
}

const guiFlags = (weight?: string, style?: string, deco?: string): string | undefined => {
    const flags: string[] = [];
    if (weight && /bold|600|700|800|900/i.test(weight)) flags.push("bold");
    if (style && /italic/i.test(style)) flags.push("italic");
    if (deco && /underline/i.test(deco)) flags.push("underline");
    return flags.length ? `gui=${flags.join(",")}` : undefined;
};

const parseInlineStyle = (style?: string | null): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!style) return out;
    for (const part of style.split(";")) {
        const m = part.split(":");
        if (m.length < 2) continue;
        const k = m[0].trim().toLowerCase();
        const v = m.slice(1).join(":").trim();
        if (k) out[k] = v;
    }
    return out;
};

/* ===========================
   CSS Vars & Inlining
   =========================== */
function collectCssVarsFromCssText(cssText: string): Map<string, string> {
    const vars = new Map<string, string>();
    try {
        const ast = css.parse(cssText);
        if (!ast.stylesheet) return vars;
        for (const rule of ast.stylesheet.rules) {
            if (rule.type !== "rule") continue;
            const r = rule as css.Rule;
            if (!r.selectors?.some((s: string) => s.trim() === ":root")) continue;
            for (const d of (r.declarations || []) as css.Declaration[]) {
                if (d.type !== "declaration") continue;
                const prop = String(d.property ?? "");
                const val = String(d.value ?? "");
                if (prop.startsWith("--")) vars.set(prop, val);
            }
        }
    } catch {
        // ignore issues with parsing the css text
    }
    return vars;
}

function extractStylesheetHrefs(html: string): string[] {
    const doc = parse(html);
    return doc
        .querySelectorAll('link[rel="stylesheet"]')
        .map((l) => l.getAttribute("href"))
        .filter((s): s is string => !!s);
}

async function loadStylesheets(html: string, rootDir?: string): Promise<string> {
    const hrefs = extractStylesheetHrefs(html);
    let combined = "";
    for (const href of hrefs) {
        const filePath = path.isAbsolute(href) ? href : path.join(rootDir ?? process.cwd(), href);
        try {
            combined += (await fs.readFile(filePath, "utf8")) + "\n";
        } catch {
            // ignore any missing/unreadable css file
        }
    }
    return combined;
}

/* ===========================
   HLJS group mapping
   =========================== */
function classToHLGroup(cls: string): string | undefined {
    switch (cls) {
        case "hljs-keyword":
            return "HLJSKeyword";
        case "hljs-title":
            return "HLJSTitle";
        case "function_":
        case "hljs-function":
            return "HLJSFunction";
        case "hljs-params":
            return "HLJSParams";
        case "hljs-literal":
            return "HLJSLiteral";
        case "hljs-number":
            return "HLJSNumber";
        case "hljs-string":
            return "HLJSString";
        case "hljs-comment":
            return "HLJSComment";
        case "hljs-built_in":
            return "HLJSBuiltIn";
        case "hljs-operator":
            return "HLJSOperator";
        case "hljs-punctuation":
            return "HLJSPunctuation";
        default:
            return undefined;
    }
}

/* ===========================
   Inline collection (with opt to suppress link tail)
   =========================== */
function collectInline(node: HNode | null, ctx: Ctx, opts?: { includeLinkTail?: boolean }): string {
    const includeLinkTail = opts?.includeLinkTail !== false;

    if (!node) return "";
    if (isText(node)) {
        const raw = decodeEntitiesBasic(node.rawText || "");
        return ctx.inPre ? raw : normalizeInline(raw);
    }
    if (!isElement(node)) return "";

    const tag = toTag(node);

    if (tag === "br") return "\n";

    if (tag === "code") {
        let s = "";
        for (const c of node.childNodes) s += collectInline(c, { ...ctx, inPre: true }, opts);
        return s;
    }

    if (tag === "a") {
        let s = "";
        for (const c of node.childNodes) s += collectInline(c, ctx, opts);
        const href = node.getAttribute("href");
        if (href && includeLinkTail) s += ` ${ICON.link} (${href})`;
        return s;
    }

    let out = "";
    for (const c of node.childNodes) out += collectInline(c, ctx, opts);
    return out;
}

/* ===========================
   Code rendering (HLJS spans)
   =========================== */
function renderCodeChild(n: HNode, b: TextAndHiBuilder, ctx: Ctx) {
    if (isText(n)) {
        const raw = decodeEntitiesBasic(n.rawText || "");
        b.append(raw, combineGroups(undefined, ctx.ambient));
        return;
    }
    if (!isElement(n)) return;

    const tag = toTag(n);
    if (tag === "span") {
        const classes = clsList(n);
        let group: string | undefined;
        for (const c of classes) {
            const g = classToHLGroup(c);
            if (g) {
                group = g;
                break;
            }
        }
        for (const c of n.childNodes) {
            if (isText(c)) {
                const raw = decodeEntitiesBasic(c.rawText || "");
                b.append(raw, combineGroups(group, ctx.ambient));
            } else {
                renderCodeChild(c, b, ctx);
            }
        }
        return;
    }

    const ctxChild = childCtxFor(n, ctx);
    for (const c of n.childNodes) renderCodeChild(c, b, ctxChild);
}

/* ===========================
   Link & Inline code
   =========================== */
function renderLink(el: HTMLElement, b: TextAndHiBuilder, ctx: Ctx) {
    const inner = collectInline(el, ctx, { includeLinkTail: false });
    const href = el.getAttribute("href") || "";
    if (inner) b.append(inner, combineGroups("LinkText", ctx.ambient));
    if (href) b.append(` ${ICON.link} (${href})`, combineGroups("LinkUrl", ctx.ambient));
}

function renderInlineCode(el: HTMLElement, b: TextAndHiBuilder, ctx: Ctx) {
    const content = collectInline(el, { ...ctx, inPre: true });
    b.append(content, combineGroups("InlineCode", ctx.ambient));
}

/* ===========================
   Inline-only walker (for paragraphs, list items, headers, etc.)
   =========================== */
function renderInlineOnly(el: HTMLElement, b: TextAndHiBuilder, ctx: Ctx): boolean {
    for (const child of el.childNodes) {
        if (isText(child)) {
            const raw = decodeEntitiesBasic(child.rawText || "");
            const s = ctx.inPre ? raw : normalizeInline(raw);
            b.append(s, combineGroups(undefined, ctx.ambient));
            continue;
        }
        if (!isElement(child)) continue;

        const tag = toTag(child);
        if (BLOCK_TAGS.has(tag) && tag !== "br") return false;

        const ctxChild = childCtxFor(child, ctx);

        switch (tag) {
            case "a":
                renderLink(child, b, ctxChild);
                break;
            case "code":
                renderInlineCode(child, b, ctxChild);
                break;
            case "br":
                b.append("\n", combineGroups(undefined, ctxChild.ambient));
                break;
            // Inline containers recurse
            case "span":
            case "strong":
            case "em":
            case "small":
            case "big":
            case "abbr":
            case "b":
            case "i":
            case "u":
            case "mark":
            case "s":
            case "sub":
            case "sup":
            case "kbd":
            case "samp":
            case "var":
            case "time":
            default:
                if (!renderInlineOnly(child, b, ctxChild)) return false;
                break;
        }
    }
    return true;
}

/* ===========================
   Render helpers (headers, paragraphs, lists, hr, table, pre, blocks)
   =========================== */
function renderHeader(el: HTMLElement, b: TextAndHiBuilder, level: number, ctx: Ctx) {
    let icon: string;
    switch (level) {
        case 1:
            icon = ICON.h1;
            break;
        case 2:
            icon = ICON.h2;
            break;
        case 3:
            icon = ICON.h3;
            break;
        case 4:
            icon = ICON.h4;
            break;
        case 5:
            icon = ICON.h5;
            break;
        default:
            icon = ICON.h6;
    }
    const group = `Header${Math.max(1, Math.min(6, level))}`;

    b.append(`${icon} `, combineGroups(group, ctx.ambient));
    const ctxWithHeader: Ctx = { ...ctx, ambient: [...(ctx.ambient ?? []), group] };
    renderInlineOnly(el, b, { ...ctxWithHeader, inPre: false });
    b.append("\n");
    b.append("\n");
}

function renderParagraph(el: HTMLElement, b: TextAndHiBuilder, ctx: Ctx) {
    const okInline = renderInlineOnly(el, b, { ...ctx, inPre: false });
    if (!okInline) {
        const txt = collectInline(el, { ...ctx, inPre: false }).trim();
        if (txt.length > 0) b.append(txt, combineGroups(undefined, ctx.ambient));
    }
    b.append("\n");
    b.append("\n");
}

function renderList(el: HTMLElement, b: TextAndHiBuilder, ctx: Ctx, ordered: boolean) {
    let index = 1;
    for (const li of el.childNodes) {
        if (!isElement(li) || toTag(li) !== "li") continue;

        const ctxLi = childCtxFor(li, ctx);
        const prefix = ordered ? `${index}.` : ICON.h6;

        b.append(" ");
        b.append(`${prefix}`, combineGroups("ListBullet", ctxLi.ambient));

        const okInline = renderInlineOnly(li, b, { ...ctxLi, inPre: false });
        if (!okInline) {
            const lineText = collectInline(li, { ...ctxLi, inPre: false }).trim();
            b.append(lineText, combineGroups(undefined, ctxLi.ambient));
        }

        b.append("\n");
        index++;
    }
    b.append("\n");
}

function renderHR(b: TextAndHiBuilder) {
    const line = repeat("─", 40);
    b.appendLine(line, "Rule");
    b.append("\n");
}

// Common block container: ensure it starts/ends with proper spacing; children handle their own spacing.
function renderBlockContainer(el: HTMLElement, b: TextAndHiBuilder, ctx: Ctx) {
    if (b.col !== 0) b.append("\n", combineGroups(undefined, ctx.ambient));
    for (const c of el.childNodes) renderNode(c, b, ctx);
    if (b.col !== 0) b.append("\n", combineGroups(undefined, ctx.ambient));
    b.append("\n");
}

// Blockquote with pretty wall prefix.
function renderBlockQuote(el: HTMLElement, b: TextAndHiBuilder, ctx: Ctx) {
    if (b.col !== 0) b.append("\n", combineGroups(undefined, ctx.ambient));
    const txt = collectInline(el, { ...ctx, inPre: false });
    const lines = txt.replace(/^(?:\n+|\n+)$/g, "").split("\n");
    for (const line of lines) {
        b.append("│ ", combineGroups("BlockQuoteBorder", ctx.ambient));
        b.append(line.trim(), combineGroups("BlockQuote", ctx.ambient));
        b.append("\n");
    }
    b.append("\n");
}

function flushTempCodeBlockToMain(temp: TextAndHiBuilder, dest: TextAndHiBuilder, bgGroup: string) {
    const lineOffset = dest.line;
    const text = temp.text();

    // Split to lines and drop trailing empty line(s) that result from a final '\n'
    let lines = text.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    if (lines.length === 0) {
        // nothing meaningful to render
        return;
    }

    // compute max width in bytes across actual lines
    let maxWidth = 0;
    for (const ln of lines) {
        const w = Buffer.byteLength(ln, "utf8");
        if (w > maxWidth) maxWidth = w;
    }

    const startLine = dest.line;

    // append content line by line, padding to maxWidth
    lines.forEach((ln, i) => {
        dest.append(ln);
        const padBytes = maxWidth - Buffer.byteLength(ln, "utf8");
        if (padBytes > 0) dest.append(" ".repeat(padBytes)); // ensure rectangular area exists
        if (i < lines.length - 1) dest.append("\n");
    });

    const endLine = dest.line;

    // transfer HLJS/diff token highlights with line offset
    for (const hi of temp.highlights) {
        dest.highlights.push({
            hlGroup: hi.hlGroup,
            lnum: hi.lnum + lineOffset,
            colStart: hi.colStart,
            colEnd: hi.colEnd
        });
    }

    // rectangular background across all lines at fixed width
    dest.markBgRect(startLine, endLine, bgGroup, maxWidth);
}

// Table with caption + precise border highlighting
function renderTable(el: HTMLElement, b: TextAndHiBuilder, ctx: Ctx) {
    const rows: string[][] = [];
    let headerRow: string[] | null = null;

    const pushRowFrom = (tr: HTMLElement) => {
        const cells: string[] = [];
        for (const cell of tr.childNodes) {
            if (!isElement(cell)) continue;
            const tag = toTag(cell);
            if (tag !== "td" && tag !== "th") continue;
            const cellTxt = collectInline(cell, { ...ctx, inPre: false }).trim();
            cells.push(cellTxt);
        }
        if (cells.length) rows.push(cells);
    };

    const captionEl = el.querySelector("caption");
    const captionText = captionEl ? collectInline(captionEl, { ...ctx, inPre: false }).trim() : "";

    const thead = el.querySelector("thead");
    if (thead) {
        const tr = thead.querySelector("tr");
        if (tr) {
            const tmp: string[] = [];
            for (const th of tr.childNodes) {
                if (!isElement(th)) continue;
                if (toTag(th) !== "th") continue;
                tmp.push(collectInline(th, { ...ctx, inPre: false }).trim());
            }
            if (tmp.length) headerRow = tmp;
        }
    }

    const tbodies = el.querySelectorAll("tbody");
    if (tbodies.length) {
        for (const tb of tbodies) for (const tr of tb.querySelectorAll("tr")) pushRowFrom(tr);
    } else {
        for (const tr of el.querySelectorAll("tr")) pushRowFrom(tr);
    }

    const allRows = headerRow ? [headerRow, ...rows] : rows;

    const title = captionText ? `${ICON.table} ${captionText}` : `${ICON.table} Table`;
    b.appendLine(title, combineGroups("TableTitle", ctx.ambient));

    if (!allRows.length) {
        b.append("\n");
        return;
    }

    const colCount = Math.max(...allRows.map((r) => r.length));
    const widths: number[] = new Array(colCount).fill(0);
    for (const r of allRows) {
        for (let i = 0; i < colCount; i++) {
            const c = r[i] ?? "";
            const w = [...c].length;
            widths[i] = Math.max(widths[i], w);
        }
    }

    const padCell = (s: string, w: number) => s + repeat(" ", Math.max(0, w - [...s].length));
    const drawHBorder = (left: string, mid: string, right: string) => {
        b.append(left, combineGroups("TableBorder", ctx.ambient));
        for (let i = 0; i < widths.length; i++) {
            b.append(repeat("─", widths[i] + 2), combineGroups("TableBorder", ctx.ambient));
            b.append(i === widths.length - 1 ? right : mid, combineGroups("TableBorder", ctx.ambient));
        }
        b.append("\n");
    };
    const drawRow = (cells: string[], contentGroup?: string | string[]) => {
        b.append("│", combineGroups("TableBorder", ctx.ambient));
        for (let i = 0; i < widths.length; i++) {
            const c = cells[i] ?? "";
            b.append(" ");
            b.append(padCell(c, widths[i]), combineGroups(contentGroup, ctx.ambient));
            b.append(" ");
            b.append("│", combineGroups("TableBorder", ctx.ambient));
        }
        b.append("\n");
    };

    drawHBorder("┌", "┬", "┐");
    if (headerRow) {
        drawRow(headerRow, "TableHeader");
        drawHBorder("├", "┼", "┤");
    }
    let ri = 0;
    for (const row of rows) {
        drawRow(row);
        if (ri !== rows.length - 1) drawHBorder("├", "┼", "┤");
        ri++;
    }
    drawHBorder("└", "┴", "┘");
    b.append("\n");
}

function renderPreDiff(preEl: HTMLElement, b: TextAndHiBuilder, ctx: Ctx) {
    if (b.col !== 0) b.append("\n");

    const container = preEl.querySelector(`.${DIFF_CONTAINER_CLASS}`);
    if (!container) return;

    // render into temporary builder for the whole diff block (will later be flushed)
    const tb = new TextAndHiBuilder();

    for (const n of container.childNodes) {
        if (isText(n)) {
            const raw = decodeEntitiesBasic(n.rawText || "");
            tb.append(raw, combineGroups(undefined, ctx.ambient));
            continue;
        }
        if (!isElement(n)) continue;

        // If it's not a div (e.g. stray text or nodes), just render them normally into tb
        if (toTag(n) !== "div") {
            const ctxChild = childCtxFor(n, ctx);
            for (const c of n.childNodes) renderNode(c, tb as any, ctxChild);
            continue;
        }

        // n is a div inside the diff container — it may contain hljs spans etc.
        const classes = clsList(n);
        let overlayGroup: string | undefined;
        if (classes.includes(DIFF_ADDED_CLASS)) {
            overlayGroup = "DiffAdd";
        } else if (classes.includes(DIFF_REMOVED_CLASS)) {
            overlayGroup = "DiffDelete";
        } else {
            overlayGroup = undefined;
        }

        // 1) Render this div's children into a small builder so we keep token highlights
        const divTb = new TextAndHiBuilder();
        for (const child of n.childNodes) {
            if (isText(child)) {
                const raw = decodeEntitiesBasic(child.rawText || "");
                divTb.append(raw, combineGroups(undefined, ctx.ambient));
            } else if (isElement(child)) {
                // use renderCodeChild so hljs spans are respected (it emits highlights into divTb)
                renderCodeChild(child, divTb, { ...ctx, inPre: true });
            }
        }

        // drop leading newlines (same behaviour as before)
        let divText = divTb.text().replace(/^\n+/, "");
        if (!divText) continue;

        // 2) append divText into tb and copy divTb.highlights with proper offsets
        const startLine = tb.line;
        const startByteCol = tb.byteCol;

        // Append the text (no overlay group) into tb preserving newlines
        tb.append(divText);

        // Copy token highlights from divTb, adjusting line numbers and first-line byte offset
        for (const hi of divTb.highlights) {
            const newLnum = startLine + hi.lnum;
            const colOffset = hi.lnum === 0 ? startByteCol : 0;
            tb.highlights.push({
                hlGroup: hi.hlGroup,
                lnum: newLnum,
                colStart: hi.colStart + colOffset,
                colEnd: hi.colEnd + colOffset
            });
        }

        // 3) add overlay highlights (DiffAdd/DiffDelete) across the full width of each rendered line
        if (overlayGroup) {
            const lines = divText.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const lineIndex = startLine + i;
                // compute byte length of that line
                const byteLen = Buffer.byteLength(lines[i], "utf8");
                const colStart = i === 0 ? startByteCol : 0;
                const colEnd = colStart + byteLen;
                // Only push overlay if there's something (but allow zero-length if you want full-line overlay)
                tb.highlights.push({
                    hlGroup: overlayGroup,
                    lnum: lineIndex,
                    colStart,
                    colEnd
                });
            }
        }
    }

    // flush (pad to rectangle, copy HLs, mark background)
    flushTempCodeBlockToMain(tb, b, CODE_BLOCK_BACKGROUND);

    if (b.col !== 0) b.append("\n");
    b.append("\n"); // exactly one empty line after diff block
}

function renderPreCode(el: HTMLElement, b: TextAndHiBuilder, ctx: Ctx) {
    if (b.col !== 0) b.append("\n");

    // Render the <code> content into a temp builder
    const tb = new TextAndHiBuilder();

    // Trim ALL leading newlines from the first text node
    let leading = true;
    for (const n of el.childNodes) {
        if (leading && isText(n)) {
            const raw = decodeEntitiesBasic(n.rawText || "");
            const trimmed = raw.replace(/^\n+/, "");
            if (trimmed.length > 0) {
                tb.append(trimmed, combineGroups(undefined, ctx.ambient));
                leading = false;
                continue;
            }
            continue;
        }
        leading = false;
        renderCodeChild(n, tb, { ...ctx, inPre: true });
    }

    // flush (pad to rectangle, copy HLs, mark background)
    flushTempCodeBlockToMain(tb, b, CODE_BLOCK_BACKGROUND);

    if (b.col !== 0) b.append("\n");
    b.append("\n"); // exactly one empty line after block
}

/* ===========================
   Main traversal
   =========================== */
function childCtxFor(el: HTMLElement, ctx: Ctx): Ctx {
    const extras: string[] = [];
    for (const c of clsList(el)) {
        const g = STYLE_AMBIENT.classToGroup[c];
        if (g) extras.push(g);
    }
    if (!extras.length) return ctx;
    return { ...ctx, ambient: [...(ctx.ambient || []), ...extras] };
}

function renderNode(node: HNode, b: TextAndHiBuilder, ctx: Ctx) {
    if (isText(node)) {
        const raw = decodeEntitiesBasic(node.rawText || "");
        if (!ctx.inPre && /^\s+$/.test(raw)) {
            if (b.byteCol === 0) return;
            b.append(" ", combineGroups(undefined, ctx.ambient));
            return;
        }
        const s = ctx.inPre ? raw : normalizeInline(raw);
        b.append(s, combineGroups(undefined, ctx.ambient));
        return;
    }
    if (!isElement(node)) return;

    const tag = toTag(node);
    const ctxChild = childCtxFor(node, ctx);

    switch (tag) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
            renderHeader(node, b, Number(tag[1]), ctxChild);
            return;

        case "p":
            renderParagraph(node, b, ctxChild);
            return;

        case "ul":
            renderList(node, b, ctxChild, false);
            return;
        case "ol":
            renderList(node, b, ctxChild, true);
            return;

        case "li": {
            const ctxLi = ctxChild;
            const prefix = ICON.h6;
            b.append(" ");
            b.append(`${prefix}`, combineGroups("ListBullet", ctxLi.ambient));
            const okInline = renderInlineOnly(node, b, { ...ctxLi, inPre: false });
            if (!okInline) {
                const lineText = collectInline(node, { ...ctxLi, inPre: false }).trim();
                b.append(lineText, combineGroups(undefined, ctxLi.ambient));
            }
            b.append("\n");
            return;
        }

        case "hr":
            renderHR(b);
            return;
        case "br":
            b.append("\n", combineGroups(undefined, ctxChild.ambient));
            return;

        case "a":
            renderLink(node, b, ctxChild);
            return;

        case "pre": {
            const diffContainer = node.querySelector(`.${DIFF_CONTAINER_CLASS}`);
            if (diffContainer) {
                renderPreDiff(node, b, ctxChild);
                return;
            }
            const code = node.querySelector("code");
            if (code) {
                renderPreCode(code, b, ctxChild);
                return;
            }
            // raw <pre> with only text → treat as code block
            if (b.col !== 0) b.append("\n");
            const tb = new TextAndHiBuilder();
            const preTxt = collectInline(node, { ...ctxChild, inPre: true }).replace(/^\n+/, "");
            tb.append(preTxt, combineGroups(undefined, ctxChild.ambient));
            flushTempCodeBlockToMain(tb, b, CODE_BLOCK_BACKGROUND);
            if (b.col !== 0) b.append("\n");
            b.append("\n");
            return;
        }

        case "code":
            renderInlineCode(node, b, ctxChild);
            return;

        case "table":
            renderTable(node, b, ctxChild);
            return;

        case "blockquote":
            renderBlockQuote(node, b, ctxChild);
            return;

        case "figure": {
            if (b.col !== 0) b.append("\n", combineGroups(undefined, ctxChild.ambient));
            for (const c of node.childNodes) {
                if (isElement(c) && toTag(c) === "figcaption") continue;
                renderNode(c, b, ctxChild);
            }
            const cap = node.querySelector("figcaption");
            if (cap) {
                const capText = collectInline(cap, { ...ctxChild, inPre: false }).trim();
                if (capText) b.appendLine(capText, combineGroups("FigureCaption", ctxChild.ambient));
            }
            if (b.col !== 0) b.append("\n", combineGroups(undefined, ctxChild.ambient));
            b.append("\n");
            return;
        }

        case "fieldset": {
            if (b.col !== 0) b.append("\n", combineGroups(undefined, ctxChild.ambient));
            const legend = node.querySelector("legend");
            if (legend) {
                const legendText = collectInline(legend, { ...ctxChild, inPre: false }).trim();
                if (legendText) b.appendLine(`${ICON.h4} ${legendText}`, combineGroups("Header4", ctxChild.ambient));
            }
            for (const c of node.childNodes) {
                if (isElement(c) && toTag(c) === "legend") continue;
                renderNode(c, b, ctxChild);
            }
            if (b.col !== 0) b.append("\n", combineGroups(undefined, ctxChild.ambient));
            b.append("\n");
            return;
        }

        case "address":
        case "section":
        case "article":
        case "aside":
        case "header":
        case "footer":
        case "main":
        case "nav":
        case "form":
            renderBlockContainer(node, b, ctxChild);
            return;

        case "div": {
            if (!hasBlockChild(node) && hasNonWhitespaceText(node)) {
                if (b.col !== 0) b.append("\n", combineGroups(undefined, ctxChild.ambient));
                const okInline = renderInlineOnly(node, b, { ...ctxChild, inPre: false });
                if (!okInline) {
                    const txt = collectInline(node, { ...ctxChild, inPre: false }).trim();
                    if (txt) b.append(txt, combineGroups(undefined, ctxChild.ambient));
                }
                if (b.col !== 0) b.append("\n", combineGroups(undefined, ctxChild.ambient));
                b.append("\n");
                return;
            }
            for (const c of node.childNodes) renderNode(c, b, ctxChild);
            return;
        }

        // Definition list items
        case "dl":
        case "dt":
        case "dd": {
            const okInline = renderInlineOnly(node, b, { ...ctxChild, inPre: false });
            if (!okInline) {
                const txt = collectInline(node, { ...ctxChild, inPre: false }).trim();
                if (txt) b.append(txt, combineGroups(undefined, ctxChild.ambient));
            }
            b.append("\n");
            return;
        }

        case "span":
        case "strong":
        case "em":
        case "small":
        case "big":
        case "abbr":
        case "b":
        case "i":
        case "u":
        case "mark":
        case "s":
        case "sub":
        case "sup":
        case "kbd":
        case "samp":
        case "var":
        default: {
            for (const c of node.childNodes) renderNode(c, b, ctxChild);
            return;
        }
    }
}

/* ===========================
   Root orchestration
   =========================== */
function renderFromRoot(root: HTMLElement): RenderResult {
    const b = new TextAndHiBuilder();
    const ctx: Ctx = { inPre: false };
    const body = root.querySelector("body") ?? root;

    renderNode(body, b, ctx);

    const fullText = b.text();
    const bgHi = b.buildBackgroundHighlights(fullText);
    const finalText = fullText.replace(/\s+$/, "");
    const finalLineCount = finalText.split("\n").length;
    const safeBg = bgHi.filter((h) => h.lnum < finalLineCount);

    return { text: finalText, highlights: [...b.highlights, ...safeBg] };
}

export function renderRuleHtmlToTextAndHighlights(html: string): RenderResult {
    const root = parse(html, { blockTextElements: { script: false, style: false } }) as unknown as HTMLElement;
    return renderFromRoot(root);
}

export async function renderRuleHtmlWithCss(html: string, opts: { rootDir?: string } = {}): Promise<RenderWithCssResult> {
    const cssText = await loadStylesheets(html, opts.rootDir ?? util.extensionPath);
    const cssVars = collectCssVarsFromCssText(cssText);
    const inlined = juice.inlineContent(html, cssText);

    const root = parse(inlined, { blockTextElements: { script: false, style: false } }) as unknown as HTMLElement;

    const classToGroup: Record<string, string> = {};
    const groupStyle: Record<string, { fg?: string; bg?: string; gui?: string }> = {};

    const styled = root.querySelectorAll("[class][style]") || [];
    for (const el of styled) {
        const style = parseInlineStyle(el.getAttribute("style"));
        const rawColor = resolveCssVarValue(stripImportant(style["color"]), cssVars);
        const rawBg = resolveCssVarValue(stripImportant(style["background-color"] ?? style["background"]), cssVars);

        const fg = normalizeCssColorToHex(rawColor, cssVars);
        const bg = normalizeCssColorToHex(rawBg, cssVars);
        const gui = guiFlags(style["font-weight"], style["font-style"], style["text-decoration"]);

        const classes = clsList(el);
        for (const c of classes) {
            const group = groupForClass(c);
            classToGroup[c] = group;
            if (!groupStyle[group] && (fg || bg)) groupStyle[group] = { fg, bg, gui };
        }
    }

    const hiCommands: string[] = [];

    for (const [group, s] of Object.entries(groupStyle)) {
        const parts = [`hi ${group}`];
        if (s.fg) parts.push(`guifg=${s.fg}`);
        if (s.bg) parts.push(`guibg=${s.bg}`);
        if (s.gui) parts.push(s.gui);
        if (parts.length > 1) hiCommands.push(parts.join(" "));
    }

    for (const c of hiCommands) {
        await nvim.command(c);
    }

    setStyleDrivenClassGroups(classToGroup);
    const { text, highlights } = renderFromRoot(root);
    return { text, highlights };
}
