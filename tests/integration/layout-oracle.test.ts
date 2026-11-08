/**
 * Oracle check (CONTRACT.md acceptance 1, layout half): StyledTrees built from Firefox's computed styles
 * (tests/fixtures/oracle) over the fixture markup (node-html-parser, test-only glue), laid out by the
 * box engine; the buffer must show what those styles imply: every word once, block siblings on their own lines,
 * margins as blank lines, list markers, left borders. Lengths use the style part's mapping (px /8 h, /16 v); the
 * layout hints the UA sheet would set are simulated here for `pre`, `a[href]` and `br` (test glue only).
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { HTMLElement, Node as HtmlNode, TextNode, parse } from "node-html-parser";
import { fixturesDir, loadFixture } from "../fixtures";
import type { ComputedStyle, Display, ListStyleType, StyledElement, StyledNode, StyledTree, WhiteSpace } from "@htmlview/engine/style";
import { initialStyle } from "@htmlview/engine/style";
import { buildBoxes, layoutBoxes, placeBoxes } from "@htmlview/engine/layout/index";
import type { Layout } from "@htmlview/types";
import type { PlacedBox, PlacedTree } from "@htmlview/engine/layout/index";
import { violations } from "@htmlview-tests/engine/layout/testkit";

interface OracleElement {
    tag: string;
    style: Record<string, string>;
    before?: string;
    after?: string;
}

const DISPLAYS: ReadonlySet<string> = new Set(["none", "block", "inline", "inline-block", "list-item", "table", "table-caption", "table-header-group", "table-row-group", "table-footer-group", "table-row", "table-cell", "flex", "contents"]);

function px(v: string | undefined, per: number): number {
    const n: number = parseFloat(v ?? "0");
    return Number.isNaN(n) ? 0 : Math.floor(n / per + 0.5);
}

function toStyle(o: OracleElement, parent: ComputedStyle, attrs: Record<string, string>): ComputedStyle {
    const s: Record<string, string> = o.style;
    const d: string = s.display === "inline-flex" ? "flex" : s.display;
    const side = (k: string): ComputedStyle["border"]["top"] =>
        s[`border-${k}-style`] !== "none" ? { style: "solid", width: 1, color: { var: "--vscode-border", attr: "fg" } } : { style: "none", width: 0, color: parent.color };
    const lst: string = s["list-style-type"];
    const custom: Record<string, string> = {};
    if (o.tag === "pre") {
        custom["--htmlview-code"] = "block";
    }
    if (o.tag === "a" && attrs.href !== undefined) {
        custom["--htmlview-link"] = "href";
    }
    if (o.tag === "br") {
        custom["--htmlview-break"] = "line";
    }
    return {
        ...initialStyle(),
        display: (DISPLAYS.has(d) ? d : "block") as Display,
        whiteSpace: s["white-space"] as WhiteSpace,
        listStyleType: (["none", "disc", "circle", "square", "decimal"].includes(lst) ? lst : "disc") as ListStyleType,
        margin: { top: px(s["margin-top"], 16), right: px(s["margin-right"], 8), bottom: px(s["margin-bottom"], 16), left: px(s["margin-left"], 8) },
        padding: { top: px(s["padding-top"], 16), right: px(s["padding-right"], 8), bottom: px(s["padding-bottom"], 16), left: px(s["padding-left"], 8) },
        border: { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") },
        custom,
    };
}

function unquote(v: string | undefined): string | undefined {
    return v !== undefined && v.startsWith('"') ? JSON.parse(v) : undefined;
}

/** Builds the StyledTree, zipping parsed elements (preorder) with the oracle's elements. */
function styledFromOracle(name: string): StyledTree {
    const oracle: OracleElement[] = JSON.parse(fs.readFileSync(path.join(fixturesDir, "oracle", name + ".json"), "utf8")).elements;
    let next: number = 0;
    let ids: number = 0;
    const convert = (el: HTMLElement, parent: ComputedStyle): StyledElement => {
        const o: OracleElement = oracle[next++];
        const tag: string = el.tagName.toLowerCase();
        assert.equal(o.tag, tag, `${name}: oracle order`);
        const attrs: Record<string, string> = { ...el.attributes };
        const style: ComputedStyle = toStyle(o, parent, attrs);
        const id: number = ids++;
        const children: StyledNode[] = el.childNodes
            .map((c: HtmlNode): StyledNode | undefined => (c instanceof HTMLElement ? convert(c, style) : c instanceof TextNode ? { kind: "text", text: c.text, id: ids++ } : undefined))
            .filter((c: StyledNode | undefined): c is StyledNode => c !== undefined);
        const pseudo = (kind: "before" | "after", text: string | undefined): StyledElement["before"] =>
            text !== undefined ? { kind: "pseudo", pseudo: kind, style: { ...initialStyle(), whiteSpace: style.whiteSpace }, paint: [], text } : undefined;
        return {
            kind: "element",
            element: { type: "element", id, tag, attrs, classList: (attrs.class ?? "").split(/\s+/).filter((c: string): boolean => c !== ""), children: [] },
            style,
            paint: [],
            before: pseudo("before", unquote(o.before)),
            after: pseudo("after", unquote(o.after)),
            children,
        };
    };
    const body: HTMLElement = parse(`<html><body>${loadFixture(name)}</body></html>`, { blockTextElements: { pre: true } }).querySelector("html") as HTMLElement;
    return { root: convert(body, initialStyle()), groups: [] };
}

function walk(p: PlacedBox, fn: (p: PlacedBox, parent?: PlacedBox) => void, parent?: PlacedBox): void {
    fn(p, parent);
    p.children.forEach((c: PlacedBox): void => walk(c, fn, p));
}

const FIXTURES: readonly string[] = ["edge-mixed-li", "edge-pre-in-li", "edge-wide-table", "edge-widths", "rule-sections"];

for (const name of FIXTURES) {
    test(`engine/layout oracle: ${name} lays out what Firefox's computed styles imply`, () => {
        const styled: StyledTree = styledFromOracle(name);
        const out: Layout = layoutBoxes(styled, { width: 72, tabstop: 4, virtual: false });
        assert.deepEqual(violations(out), [], name);
        // no character of the text content lost (wrapping may split words; grid glyphs and markers come on top)
        const html: HTMLElement = parse(loadFixture(name), { blockTextElements: { pre: true } });
        const count = (text: string): Map<string, number> => {
            const m: Map<string, number> = new Map();
            for (const ch of text.replace(/\s+/g, "")) {
                m.set(ch, (m.get(ch) ?? 0) + 1);
            }
            return m;
        };
        const have: Map<string, number> = count(out.lines.join(""));
        const missing: string[] = [...count(html.text).entries()].filter(([ch, n]: [string, number]): boolean => (have.get(ch) ?? 0) < n).map(([ch]: [string, number]): string => ch);
        assert.deepEqual(missing, [], `${name}: characters lost`);
        // block siblings never share a line; non-zero collapsed margins leave blank lines
        const tree: PlacedTree = placeBoxes(buildBoxes(styled), { width: 72, tabstop: 4, virtual: false });
        walk(tree.root, (p: PlacedBox): void => {
            const blocks: PlacedBox[] = p.children.filter((c: PlacedBox): boolean => (c.box.kind === "block" || c.box.kind === "list-item" || c.box.kind === "table") && c.endLine >= c.startLine);
            blocks.forEach((b: PlacedBox, i: number): void => {
                const prev: PlacedBox | undefined = blocks[i - 1];
                if (prev !== undefined) {
                    const gap: number = Math.max(prev.box.style.margin.bottom, b.box.style.margin.top);
                    assert.ok(b.startLine >= prev.endLine + (gap > 0 ? 2 : 1), `${name}: siblings at ${prev.endLine}/${b.startLine}`);
                }
            });
            if (p.box.kind === "list-item" && p.box.style.listStyleType !== "none") {
                assert.ok(p.children.some((c: PlacedBox): boolean => c.box.kind === "marker" && c.ranges.length > 0), `${name}: list marker`);
            }
            if ((p.box.kind === "block" || p.box.kind === "list-item") && p.box.style.border.left.width > 0 && p.endLine >= p.startLine) {
                const col: number = p.contentCol - p.box.style.padding.left - 1;
                assert.ok("│┌└".includes([...tree.lines[p.startLine]].slice(col, col + 1).join("") || "?"), `${name}: left border at ${p.startLine}:${col}`);
            }
        });
    });
}
