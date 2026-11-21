/**
 * Firefox oracle (CONTRACT.md acceptance 1, the primary truth): for every fixture in
 * tests/fixtures/oracle/, compute styles with the engine (UA + the same upstream sheets, body
 * `vscode-dark`) and compare with Firefox's computed styles per element: display, white-space, font-weight
 * (bold ⇔ ≥ 600), font-style, text-decoration-line, list-style-type, margins/padding/borders (non-zero ⇔
 * non-zero cells), colour SOURCES (a sentinel colour names the `--vscode-*` variable that fed it, a literal must
 * match) and `::before`/`::after` content. Prints the agreement per property and per fixture, and asserts that
 * every remaining mismatch is one of the documented deviations below (terminal adaptations).
 * `ORACLE_REPORT=1 npm test` prints the table; `ORACLE_ALL=1` lists every mismatch.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import type { Color, StyledElement, StyledNode, StyleEnv } from "@htmlview/engine/style/index";
import { defaultHostVars } from "@htmlview/engine/style/host";
import { computeStyles, parseSheets } from "@htmlview/engine/style/index";
import { parseDocument } from "@htmlview/engine/dom";
import { initialFormState } from "@htmlview/engine/interact";
import { displayOf } from "@htmlview/engine/style/properties";
import { cssString } from "@htmlview/engine/style/values";

interface OracleElement {
    path: string;
    tag: string;
    id?: string;
    class?: string;
    style: Record<string, string>;
    before?: string;
    after?: string;
}

interface Oracle {
    name: string;
    elements: OracleElement[];
}

const ROOT: string = process.cwd();
const ORACLE_DIR: string = path.join(ROOT, "tests", "fixtures", "oracle");
const VIEW_SHEETS: Record<string, string[]> = { rule: ["theme.css", "rule.css", "hotspot.css", "vs.css"], hotspot: ["rule.css", "hotspot.css", "vs.css"] };
const SIDE_PROPS: string[] = ["top", "right", "bottom", "left"].flatMap((s: string) => [`margin-${s}`, `padding-${s}`, `border-${s}-style`]);
/** Properties that must agree everywhere except for a documented deviation. */
const STRICT: string[] = ["display", "white-space", "font-weight", "font-style", "text-decoration-line", "list-style-type"];
const PROPS: string[] = [...STRICT, "color", "background-color", ...SIDE_PROPS, "content"];

const VARS: Record<string, string> = JSON.parse(fs.readFileSync(path.join(ORACLE_DIR, "vars.json"), "utf8"));
const SENTINEL: Map<string, string> = new Map<string, string>(
    Object.entries(VARS)
        .filter(([, v]: [string, string]) => /^rgb\(1, /.test(v))
        .map(([k, v]: [string, string]): [string, string] => [v, k]),
);

/** A deviation from the browser that the engine makes on purpose, with its reason. */
interface Deviation {
    reason: string;
    applies: (prop: string, o: OracleElement, ours: StyledElement) => boolean;
}

const HEADING: RegExp = /^h[1-6]$/;
const inside = (o: OracleElement, re: RegExp): boolean => o.path.split(">").slice(0, -1).some((s: string) => re.test(s));

const DEVIATIONS: Deviation[] = [
    {
        reason: "terminal: headings take a per-level colour and a ::before marker in place of the font size",
        applies: (p: string, o: OracleElement) => (p === "color" || p === "content") && (HEADING.test(o.tag) || inside(o, /^h[1-6][#.:]/)),
    },
    {
        reason: "terminal: small/sub/sup are muted text in place of a smaller font",
        applies: (p: string, o: OracleElement) => p === "color" && (/^(small|sub|sup)$/.test(o.tag) || inside(o, /^(small|sub|sup)[#.:]/)),
    },
    {
        reason: "terminal: tables and cells are drawn with box borders (FloatBorder); th and caption use the table-header role",
        applies: (p: string, o: OracleElement) =>
            (/^border-/.test(p) && /^(table|td|th)$/.test(o.tag)) || (p === "color" && (/^(th|caption)$/.test(o.tag) || inside(o, /^(th|caption)[#.:]/))),
    },
    {
        reason: "terminal: blockquote is a bar plus the quote role colour, 2-cell side margins",
        applies: (p: string, o: OracleElement) => (o.tag === "blockquote" && /^(border-left|color)/.test(p)) || (p === "color" && inside(o, /^blockquote[#.:]/)),
    },
    {
        reason: "terminal: hr is one horizontal rule (top border only) in the border role",
        applies: (p: string, o: OracleElement) => o.tag === "hr" && (/^border-/.test(p) || p === "color"),
    },
    {
        reason: "terminal: body has no 20px side padding (the window is the frame)",
        applies: (p: string, o: OracleElement) => o.tag === "body" && /^padding-/.test(p),
    },
    {
        reason: "terminal: lengths under one cell (8px) / one line (16px) may round to 0 (code padding 0.45em, 1px cell padding, 2px margins)",
        applies: (p: string, o: OracleElement) => /^(padding|margin)-/.test(p) && Math.abs(parseFloat(o.style[p])) < (/(left|right)$/.test(p) ? 8 : 16),
    },
    {
        reason: "terminal: list markers are drawn by layout from list-style-type; the marker colour is the list-marker role",
        applies: (p: string) => p === "marker",
    },
    {
        reason: "terminal: form controls are not rendered (radio/checkbox toggle through their labels)",
        applies: (p: string, o: OracleElement) => /^(input|button|select|textarea)$/.test(o.tag),
    },
    {
        reason: "terminal: img is replaced by its alt text through the --htmlview-replaced hint (Firefox reports -moz-alt-content)",
        applies: (p: string, o: OracleElement) => p === "content" && o.tag === "img",
    },
    {
        reason: "terminal: pre always gets a code background (the code-block role) when no author sheet sets one",
        applies: (p: string, o: OracleElement) => p === "background-color" && o.tag === "pre",
    },
    {
        reason: "terminal: mark uses the Search group colours",
        applies: (p: string, o: OracleElement) => (p === "color" || p === "background-color") && o.tag === "mark",
    },
    {
        reason: "terminal: highlight.js tokens vs.css leaves unstyled get syntax role colours",
        applies: (p: string, o: OracleElement) => p === "color" && /hljs-(number|operator|punctuation|params|property|regexp)/.test(o.class || ""),
    },
];

// ---------------------------------------------------------------- comparison

function stepOf(el: StyledElement, index: number): string {
    const id: string = el.element.attrs.id ? "#" + el.element.attrs.id : "";
    return el.element.tag + id + el.element.classList.map((c: string) => "." + c).join("") + `:nth-child(${index + 1})`;
}

function indexTree(root: StyledElement): Map<string, StyledElement> {
    const out: Map<string, StyledElement> = new Map<string, StyledElement>();
    const walk = (el: StyledElement, prefix: string, index: number): void => {
        const p: string = (prefix ? prefix + ">" : "") + stepOf(el, index);
        out.set(p, el);
        el.children.filter((c: StyledNode): c is StyledElement => c.kind === "element").forEach((c: StyledElement, i: number) => walk(c, p, i));
    };
    walk(root, "", 0);
    return out;
}

function parseRgb(v: string): { hex: string; alpha: number } | undefined {
    const m: RegExpMatchArray | null = v.match(/^rgba?\(([^)]*)\)$/);
    const n: number[] = m ? m[1].split(",").map((t: string) => parseFloat(t)) : [];
    const hex: string = "#" + n.slice(0, 3).map((x: number) => Math.round(x).toString(16).padStart(2, "0")).join("");
    return m ? { hex, alpha: n.length > 3 ? n[3] : 1 } : undefined;
}

function describe(c: Color): string {
    return "hex" in c ? `${c.hex}/${c.alpha}` : "var" in c ? c.var : c.group;
}

/** Whether our colour has the same SOURCE as Firefox's computed one. */
function sameColorSource(ff: string, ours: Color): boolean {
    const sentinel: string | undefined = SENTINEL.get(ff);
    const lit = parseRgb(ff);
    let ok: boolean;
    if (sentinel !== undefined) {
        ok = "var" in ours && ours.var === sentinel;
    } else if (lit !== undefined && lit.alpha === 0) {
        ok = "hex" in ours && ours.alpha === 0;
    } else if (ff === "rgb(0, 0, 0)" && "group" in ours) {
        ok = ours.group === "HtmlViewHostCanvas";
    } else {
        ok = lit !== undefined && "hex" in ours && ours.hex === lit.hex && Math.abs(ours.alpha - lit.alpha) < 0.01;
    }
    return ok;
}

function listType(el: StyledElement): string {
    const t = el.style.listStyleType;
    return typeof t === "object" ? JSON.stringify(t.string) : t;
}

function ffListType(v: string): string {
    const s: string | undefined = cssString(v);
    return s !== undefined ? JSON.stringify(s) : v.replace("lower-latin", "lower-alpha").replace("upper-latin", "upper-alpha");
}

function decoLine(ff: string): string {
    const t: string[] = ff.split(/\s+/);
    return ["underline", "line-through", "overline"].filter((x: string) => t.includes(x)).join(" ") || "none";
}

function ourDeco(el: StyledElement): string {
    const d = el.style.textDecoration;
    return [d.underline ? "underline" : "", d.lineThrough ? "line-through" : "", d.overline ? "overline" : ""].filter((x: string) => x).join(" ") || "none";
}

function ffContent(v: string | undefined): string {
    const s: string | undefined = v !== undefined ? cssString(v) : undefined;
    return v === undefined ? "" : s !== undefined ? s : v;
}

/** Firefox's value and ours, as comparable strings, for one property. */
function values(prop: string, o: OracleElement, el: StyledElement): [string, string] {
    const ff: string = o.style[prop];
    const side: RegExpMatchArray | null = prop.match(/^(margin|padding|border)-(top|right|bottom|left)/);
    let pair: [string, string];
    if (prop === "display") {
        pair = [String(displayOf(ff)), el.style.display];
    } else if (prop === "white-space") {
        pair = [ff === "break-spaces" ? "pre-wrap" : ff, el.style.whiteSpace];
    } else if (prop === "font-weight") {
        pair = [parseFloat(ff) >= 600 ? "bold" : "normal", el.style.fontWeight >= 600 ? "bold" : "normal"];
    } else if (prop === "font-style") {
        pair = [/italic|oblique/.test(ff) ? "italic" : "normal", el.style.fontStyle];
    } else if (prop === "text-decoration-line") {
        pair = [decoLine(ff), ourDeco(el)];
    } else if (prop === "list-style-type") {
        pair = [ffListType(ff), listType(el)];
    } else if (prop === "color" || prop === "background-color") {
        const ours: Color = prop === "color" ? el.style.color : el.style.backgroundColor;
        pair = sameColorSource(ff, ours) ? [ff, ff] : [`${SENTINEL.get(ff) || ff}`, describe(ours)];
    } else if (side && side[1] === "border") {
        pair = [ff === "none" || ff === "hidden" ? "none" : "drawn", el.style.border[side[2] as "top"].width > 0 ? "drawn" : "none"];
    } else if (side) {
        const cells: number = (side[1] === "margin" ? el.style.margin : el.style.padding)[side[2] as "top"];
        pair = [parseFloat(ff) !== 0 ? "set" : "0", cells !== 0 ? "set" : "0"];
    } else {
        pair = [`${ffContent(o.before)}|${ffContent(o.after)}`, `${el.before ? el.before.text : ""}|${el.after ? el.after.text : ""}`];
    }
    return pair;
}

interface Mismatch {
    fixture: string;
    prop: string;
    path: string;
    ff: string;
    ours: string;
    reason?: string;
}

interface Report {
    /** prop → fixture → [agree, total]. */
    table: Map<string, Map<string, [number, number]>>;
    mismatches: Mismatch[];
    unmatched: Map<string, number>;
}

function sources(view: string): Array<{ name: string; text: string; origin: "author" }> {
    return VIEW_SHEETS[view].map((n: string) => ({ name: n, text: fs.readFileSync(path.join(ROOT, "styles", n), "utf8"), origin: "author" as const }));
}

function runOracle(): Report {
    const report: Report = { table: new Map(), mismatches: [], unmatched: new Map() };
    const env: StyleEnv = { themeKind: "dark", vars: defaultHostVars };
    const names: string[] = fs.readdirSync(ORACLE_DIR).filter((f: string) => f.endsWith(".json") && f !== "vars.json").map((f: string) => f.slice(0, -5)).sort();
    for (const name of names) {
        const oracle: Oracle = JSON.parse(fs.readFileSync(path.join(ORACLE_DIR, name + ".json"), "utf8"));
        const html: string = fs.readFileSync(path.join(ROOT, "tests", "fixtures", name + ".html"), "utf8");
        const sheets = parseSheets(sources(name.startsWith("hotspot") ? "hotspot" : "rule"));
        const doc = parseDocument(html);
        const tree = computeStyles(doc, sheets, env, initialFormState(doc));
        const index: Map<string, StyledElement> = indexTree(tree.root);
        for (const o of oracle.elements) {
            const el: StyledElement | undefined = index.get(o.path);
            if (el === undefined) {
                report.unmatched.set(name, (report.unmatched.get(name) || 0) + 1);
            }
            for (const prop of el !== undefined ? PROPS : []) {
                const [ff, ours] = values(prop, o, el!);
                const byFixture: Map<string, [number, number]> = report.table.get(prop) || new Map();
                const cell: [number, number] = byFixture.get(name) || [0, 0];
                byFixture.set(name, [cell[0] + (ff === ours ? 1 : 0), cell[1] + 1]);
                report.table.set(prop, byFixture);
                if (ff !== ours) {
                    const dev: Deviation | undefined = DEVIATIONS.find((d: Deviation) => d.applies(prop, o, el!));
                    report.mismatches.push({ fixture: name, prop, path: o.path, ff, ours, reason: dev ? dev.reason : undefined });
                }
            }
        }
    }
    return report;
}

function printReport(r: Report): void {
    const fixtures: string[] = [...new Set([...r.table.values()].flatMap((m: Map<string, [number, number]>) => [...m.keys()]))].sort();
    const lines: string[] = ["oracle agreement (agree/total) per property and fixture"];
    for (const [prop, byFixture] of r.table) {
        const total: [number, number] = [...byFixture.values()].reduce((a: [number, number], b: [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]], [0, 0]);
        const bad: string = fixtures
            .filter((f: string) => byFixture.has(f) && byFixture.get(f)![0] !== byFixture.get(f)![1])
            .map((f: string) => `${f} ${byFixture.get(f)![0]}/${byFixture.get(f)![1]}`)
            .join(", ");
        lines.push(`  ${prop.padEnd(22)} ${String(total[0]).padStart(5)}/${String(total[1]).padEnd(5)} ${bad}`);
    }
    const reasons: Map<string, number> = new Map<string, number>();
    r.mismatches.forEach((m: Mismatch) => reasons.set(m.reason || "UNEXPLAINED", (reasons.get(m.reason || "UNEXPLAINED") || 0) + 1));
    lines.push("mismatches by reason:");
    reasons.forEach((n: number, why: string) => lines.push(`  ${String(n).padStart(4)}  ${why}`));
    lines.push("elements the parsed DOM did not reproduce: " + ([...r.unmatched].map(([f, n]: [string, number]) => `${f} ${n}`).join(", ") || "none"));
    const unexplained: Mismatch[] = r.mismatches.filter((m: Mismatch) => m.reason === undefined);
    const listed: Mismatch[] = process.env.ORACLE_ALL !== undefined ? r.mismatches : unexplained;
    listed.forEach((m: Mismatch) => lines.push(`  ${m.reason !== undefined ? "[" + m.reason.slice(10, 40) + "]" : "?"} ${m.fixture} ${m.prop}: ff=${m.ff} ours=${m.ours} @ ${m.path.split(">").slice(-3).join(">")}`));
    if (process.env.ORACLE_REPORT !== undefined || unexplained.length > 0) {
        console.log(lines.join("\n"));
    }
}

test("engine/style: Firefox oracle agreement, every mismatch documented", () => {
    const r: Report = runOracle();
    printReport(r);
    const unexplained: Mismatch[] = r.mismatches.filter((m: Mismatch) => m.reason === undefined);
    assert.deepEqual(unexplained.map((m: Mismatch) => `${m.fixture} ${m.prop} ${m.path}`), []);
    for (const prop of STRICT) {
        const total: number = [...(r.table.get(prop) || new Map()).values()].reduce((a: number, b: [number, number]) => a + b[1], 0);
        assert.ok(total > 0, prop + " compared");
    }
});
