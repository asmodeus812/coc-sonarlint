import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import * as css from "css";
import {
    cascadeRank,
    compareCascade,
    compareSpecificity,
    matches,
    matchRules,
    parseInlineStyle,
    parseSelectorList,
    parseSheet,
} from "@htmlview/engine/css/index";
import type { ComplexSelector, MatchContext, MatchedDeclaration, Origin, PseudoElement, Stylesheet } from "@htmlview/engine/css/index";
import type { DomDocument, DomElement, DomNode } from "@htmlview/engine/dom";
import { byId } from "@htmlview-tests/testutil";

// ---- a hand-built DOM (dom/ is another part): preorder ids, parent table ----

type Spec = { tag: string; attrs?: Record<string, string>; kids?: Array<Spec | string> };

function h(tag: string, attrs: Record<string, string> = {}, ...kids: Array<Spec | string>): Spec {
    return { tag, attrs, kids };
}

function buildDoc(rootSpec: Spec): DomDocument {
    const nodes: DomNode[] = [];
    const parent: number[] = [];
    const build = (spec: Spec | string, p: number): DomNode => {
        const id: number = nodes.length;
        parent.push(p);
        let node: DomNode;
        if (typeof spec === "string") {
            node = { type: "text", id, text: spec };
            nodes.push(node);
        } else {
            const attrs: Record<string, string> = spec.attrs || {};
            const el: { -readonly [K in keyof DomElement]: DomElement[K] } = {
                type: "element", id, tag: spec.tag, attrs,
                classList: attrs.class ? [...new Set(attrs.class.split(/\s+/).filter(Boolean))] : [], children: [],
            };
            nodes.push(el);
            el.children = (spec.kids || []).map((k: Spec | string) => build(k, id));
            node = el;
        }
        return node;
    };
    const root: DomElement = build(rootSpec, -1) as DomElement;
    const body: DomElement = (nodes.find((n: DomNode) => n.type === "element" && n.tag === "body") as DomElement) || root;
    return { root, body, nodes, parent, styles: [] };
}

function ctxOf(doc: DomDocument, sheets: Stylesheet[] = [], checked: (el: DomElement) => boolean = () => false): MatchContext {
    return { doc, sheets, checked };
}

function sel(text: string): ComplexSelector {
    const list: ComplexSelector[] = parseSelectorList(text);
    assert.equal(list.length, 1, "selector did not parse: " + text);
    return list[0];
}

/** The winning value of `property` (last in cascade order). */
function winner(ctx: MatchContext, el: DomElement, property: string, pseudo?: PseudoElement): string | undefined {
    const all: MatchedDeclaration[] = matchRules(ctx, el, pseudo).filter((m: MatchedDeclaration) => m.declaration.property === property);
    return all.length > 0 ? all[all.length - 1].declaration.value : undefined;
}

function sheets(...specs: Array<[string, Origin]>): Stylesheet[] {
    const out: Stylesheet[] = [];
    let order: number = 0;
    specs.forEach(([text, origin], i: number) => {
        const sheet: Stylesheet = parseSheet(text, origin, "s" + i, order);
        order += sheet.rules.length;
        out.push(sheet);
    });
    return out;
}

const DOC: DomDocument = buildDoc(
    h("html", {}, h("body", { class: "vscode-dark" },
        h("div", { id: "d", class: "box  wide box", lang: "en-US", "data-k": "alpha beta", title: "Hello World" },
            h("p", { id: "p1" }, "one"),
            "text between",
            h("p", { id: "p2", class: "x" }, "two"),
            h("span", { id: "s1" }),
            h("p", { id: "p3" }, h("em", { id: "em" }, "deep")),
            h("span", { id: "s2" }),
        ),
        h("ul", { id: "ul" }, ...[1, 2, 3, 4, 5, 6].map((n: number) => h("li", { id: "li" + n }))),
    )),
);

// ---- conventions ----

test("engine/css: cascade tiers follow CSS Cascade 4", () => {
    const tiers: number[] = [
        cascadeRank("ua", false), cascadeRank("user", false), cascadeRank("author", false), cascadeRank("inline", false),
        cascadeRank("author", true), cascadeRank("inline", true), cascadeRank("user", true), cascadeRank("ua", true),
    ];
    assert.deepEqual(tiers, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("engine/css: specificity, then order, decide within a tier", () => {
    const md = (o: Origin, imp: boolean, sp: [number, number, number], order: number): MatchedDeclaration =>
        ({ declaration: { property: "color", value: "red", important: imp }, origin: o, specificity: sp, order });
    assert.ok(compareSpecificity([0, 1, 0], [0, 0, 9]) > 0);
    assert.ok(compareCascade(md("author", false, [0, 1, 0], 1), md("author", false, [0, 0, 1], 2)) > 0);
    assert.ok(compareCascade(md("author", false, [0, 1, 0], 1), md("author", false, [0, 1, 0], 2)) < 0);
    assert.ok(compareCascade(md("ua", true, [0, 0, 1], 1), md("inline", false, [1, 0, 0], 2)) > 0);
});

// ---- selector parsing ----

test("engine/css: selector AST for every simple form", () => {
    assert.deepEqual(sel("*").compounds, [{ simples: [{ kind: "universal" }] }]);
    assert.deepEqual(sel("DIV.a#b").compounds[0].simples, [{ kind: "type", name: "div" }, { kind: "class", name: "a" }, { kind: "id", name: "b" }]);
    assert.deepEqual(sel("[hidden]").compounds[0].simples, [{ kind: "attribute", name: "hidden" }]);
    assert.deepEqual(sel("input[type='radio']").compounds[0].simples[1], { kind: "attribute", name: "type", op: "=", value: "radio" });
    for (const op of ["=", "~=", "|=", "^=", "$=", "*="]) {
        assert.deepEqual(sel(`[A${op}"v w"]`).compounds[0].simples[0], { kind: "attribute", name: "a", op, value: "v w" });
    }
    assert.deepEqual(sel("[a=v i]").compounds[0].simples[0], { kind: "attribute", name: "a", op: "=", value: "v", insensitive: true });
    assert.deepEqual(sel(":root").compounds[0].simples, [{ kind: "root" }]);
    assert.deepEqual(sel(":checked").compounds[0].simples, [{ kind: "checked" }]);
    assert.deepEqual(sel(":first-child").compounds[0].simples, [{ kind: "nth", a: 0, b: 1, fromEnd: false, ofType: false }]);
    assert.deepEqual(sel(":last-child").compounds[0].simples, [{ kind: "nth", a: 0, b: 1, fromEnd: true, ofType: false }]);
    assert.equal(sel(":only-child").compounds[0].simples.length, 2);
    assert.deepEqual(sel(":first-of-type").compounds[0].simples, [{ kind: "nth", a: 0, b: 1, fromEnd: false, ofType: true }]);
    assert.deepEqual(sel(":last-of-type").compounds[0].simples, [{ kind: "nth", a: 0, b: 1, fromEnd: true, ofType: true }]);
    const nths: Array<[string, number, number]> = [["odd", 2, 1], ["even", 2, 0], ["3", 0, 3], ["-n+3", -1, 3], ["2n - 1", 2, -1], ["n", 1, 0], ["+5n+2", 5, 2]];
    for (const [arg, a, b] of nths) {
        assert.deepEqual(sel(`:nth-child(${arg})`).compounds[0].simples[0], { kind: "nth", a, b, fromEnd: false, ofType: false }, arg);
    }
    assert.equal(sel(":nth-last-child(2)").compounds[0].simples[0].kind, "nth");
    const not = sel("li:not(.a, p > .b)").compounds[0].simples[1];
    assert.equal(not.kind, "not");
    assert.equal(not.kind === "not" ? not.selectors.length : 0, 2);
    assert.deepEqual(sel(".a\\:b").compounds[0].simples[0], { kind: "class", name: "a:b" });
});

test("engine/css: combinators, pseudo-elements and normalised text", () => {
    const s: ComplexSelector = sel("  .tabs   .contextualTab+label ~ p>em  ");
    assert.deepEqual(s.combinators, [" ", "+", "~", ">"]);
    assert.equal(s.text, ".tabs .contextualTab + label ~ p > em");
    for (const [text, pseudo] of [["p::before", "before"], ["p:before", "before"], ["p::after", "after"], ["p:after", "after"], ["li::marker", "marker"]]) {
        assert.equal(sel(text).pseudo, pseudo, text);
        assert.equal(sel(text).compounds.length, 1);
    }
    assert.equal(sel("::before").compounds[0].simples[0].kind, "universal");
});

test("engine/css: unsupported pseudo-classes parse but never match; syntax errors drop the member", () => {
    assert.equal(sel("a:hover").compounds[0].simples[1].kind, "unsupported");
    assert.equal(sel("a:has(> b)").compounds[0].simples[1].kind, "unsupported");
    assert.equal(sel("li:nth-child(2n of .x)").compounds[0].simples[1].kind, "unsupported");
    assert.equal(sel("p::selection").compounds[0].simples[1].kind, "unsupported");
    assert.equal(parseSelectorList("a, , b").length, 2);
    for (const bad of ["", "> a", "a >", "a..b", "p::before .x", "[a", "a[=b]", ".1x", "a{"]) {
        assert.equal(parseSelectorList(bad).length, 0, JSON.stringify(bad));
    }
    assert.equal(matches(ctxOf(DOC), sel("p:hover"), byId(DOC, "p1")), false);
    assert.equal(matches(ctxOf(DOC), sel("p:not(:hover)"), byId(DOC, "p1")), true);
});

test("engine/css: specificity per selector", () => {
    const cases: Array<[string, [number, number, number]]> = [
        ["*", [0, 0, 0]], ["li", [0, 0, 1]], ["ul li", [0, 0, 2]], [".a", [0, 1, 0]], ["[type=radio]", [0, 1, 0]],
        ["#x", [1, 0, 0]], ["ul.a > li#b:first-child", [1, 2, 2]], [":root", [0, 1, 0]], ["p::before", [0, 0, 2]],
        ["p:before", [0, 0, 2]], [":only-child", [0, 1, 0]], [":not(#a, .b)", [1, 0, 0]], ["li:not(.x)", [0, 1, 1]],
        [".tabs input[type='radio']:checked + label + .tab", [0, 4, 2]], [":nth-child(2n+1)", [0, 1, 0]],
    ];
    for (const [text, spec] of cases) {
        assert.deepEqual([...sel(text).specificity], spec, text);
    }
    const order: string[] = ["#x.a", "p", "#x", ".a", "p.a"].map((t: string) => sel(t))
        .sort((a: ComplexSelector, b: ComplexSelector) => compareSpecificity(a.specificity, b.specificity)).map((s: ComplexSelector) => s.text);
    assert.deepEqual(order, ["p", ".a", "p.a", "#x", "#x.a"]);
});

// ---- matching ----

test("engine/css: simple, attribute and structural matching", () => {
    const c: MatchContext = ctxOf(DOC);
    const yes = (s: string, id: string): void => assert.equal(matches(c, sel(s), byId(DOC, id)), true, `${s} on #${id}`);
    const no = (s: string, id: string): void => assert.equal(matches(c, sel(s), byId(DOC, id)), false, `${s} on #${id}`);
    yes("*", "d"); yes("div", "d"); no("p", "d"); yes(".box.wide", "d"); no(".Box", "d"); yes("#d", "d"); no("#D", "d");
    yes("[lang]", "d"); no("[nope]", "d"); yes("[lang=en-US]", "d"); no("[lang=en-us]", "d"); yes("[lang=en-us i]", "d");
    yes("[data-k~=beta]", "d"); no("[data-k~=bet]", "d"); yes("[lang|=en]", "d"); no("[lang|=e]", "d");
    yes("[title^=Hell]", "d"); yes("[title$=World]", "d"); yes("[title*='o W']", "d"); no("[title^='']", "d");
    no(":root", "d");
    assert.equal(matches(c, sel(":root"), DOC.root), true);
    yes("p:first-child", "p1"); no("p:first-child", "p2"); yes("span:last-child", "s2"); no(":last-child", "p3");
    yes("p:first-of-type", "p1"); yes("p:last-of-type", "p3"); yes("span:first-of-type", "s1"); no("span:first-of-type", "s2");
    yes("em:only-child", "em"); no("p:only-child", "p1");
    const li = (s: string): string[] => [1, 2, 3, 4, 5, 6].filter((n: number) => matches(c, sel(s), byId(DOC, "li" + n))).map(String);
    assert.deepEqual(li(":nth-child(odd)"), ["1", "3", "5"]);
    assert.deepEqual(li(":nth-child(2n)"), ["2", "4", "6"]);
    assert.deepEqual(li(":nth-child(-n+2)"), ["1", "2"]);
    assert.deepEqual(li(":nth-child(n+5)"), ["5", "6"]);
    assert.deepEqual(li(":nth-child(3)"), ["3"]);
    assert.deepEqual(li(":nth-last-child(2)"), ["5"]);
    assert.deepEqual(li(":nth-child(3n+1)"), ["1", "4"]);
    assert.deepEqual(li("li:not(:first-child):not(:last-child)"), ["2", "3", "4", "5"]);
    assert.deepEqual(li(":not(:nth-child(odd), #li2)"), ["4", "6"]);
});

test("engine/css: descendant, child and sibling combinators through the parent table", () => {
    const c: MatchContext = ctxOf(DOC);
    const yes = (s: string, id: string): void => assert.equal(matches(c, sel(s), byId(DOC, id)), true, `${s} on #${id}`);
    const no = (s: string, id: string): void => assert.equal(matches(c, sel(s), byId(DOC, id)), false, `${s} on #${id}`);
    yes("body em", "em"); yes("html div p em", "em"); yes(".vscode-dark #d > p > em", "em"); no("div > em", "em");
    yes("p + p", "p2"); no("#p1 + span", "s1"); yes("p + span", "s1"); yes("#p1 + .x", "p2");   // text between is skipped
    yes("#p1 ~ span", "s2"); no("#p3 ~ p", "p2"); yes("p ~ p ~ p", "p3"); no("span + p + span + p", "p3");
    yes("#p2 + span + p > em", "em"); yes("div :not(span) ~ span", "s2"); no("ul ~ div", "d"); yes("div ~ ul li", "li3");
});

test("engine/css: upstream tab markup, sibling combinators and :checked through the hook", () => {
    const doc: DomDocument = buildDoc(h("html", {}, h("body", {}, h("main", { class: "tabs" },
        h("input", { type: "radio", name: "tabs", id: "tab-0", checked: "checked" }),
        h("label", { for: "tab-0", class: "tabLabel", id: "L0" }, "Title"),
        h("section", { class: "tab contextualTabContainer", id: "S0" },
            h("input", { type: "radio", name: "ctx", id: "context-0", class: "contextualTab" }),
            h("label", { for: "context-0", class: "contextLabel", id: "C0" }, "Servlet"),
            h("section", { class: "tab", id: "T0" }, "servlet code"),
            h("input", { type: "radio", name: "ctx", id: "context-1", class: "contextualTab", checked: "checked" }),
            h("label", { for: "context-1", class: "contextLabel", id: "C1" }, "JSP"),
            h("section", { class: "tab", id: "T1" }, "jsp code"),
        ),
    ))));
    const hotspot: string = readFileSync(join(process.cwd(), "styles", "hotspot.css"), "utf8");
    const state: Set<string> = new Set(["tab-0", "context-1"]);
    const c: MatchContext = ctxOf(doc, sheets([hotspot, "author"]), (el: DomElement) => state.has(el.attrs.id || ""));
    assert.equal(matches(c, sel(".tabs .contextualTab + label"), byId(doc, "C0")), true);
    assert.equal(matches(c, sel(".tabs .contextualTab + label"), byId(doc, "L0")), false);
    assert.equal(matches(c, sel(".tabs .contextualTab:checked + label"), byId(doc, "C1")), true);
    assert.equal(matches(c, sel(".tabs .contextualTab:checked + label"), byId(doc, "C0")), false);
    // the checked attribute alone means nothing: only the hook decides
    assert.equal(matches(ctxOf(doc), sel(":checked"), byId(doc, "context-1")), false);
    assert.equal(winner(c, byId(doc, "T1"), "display"), "block");
    assert.equal(winner(c, byId(doc, "T0"), "display"), "none");
    assert.equal(winner(c, byId(doc, "S0"), "display"), "flex");
    assert.equal(winner(c, byId(doc, "C1"), "color"), "var(--vscode-button-foreground)");
    assert.equal(winner(c, byId(doc, "C0"), "color"), "var(--vscode-button-background)");
    // toggling the state re-runs the cascade
    state.delete("context-1");
    state.add("context-0");
    assert.equal(winner(c, byId(doc, "T0"), "display"), "block");
    assert.equal(winner(c, byId(doc, "T1"), "display"), "none");
    assert.equal(winner(c, byId(doc, "C0"), "color"), "var(--vscode-button-foreground)");
    assert.equal(winner(c, byId(doc, "C0"), "border-top-left-radius"), "10%");      // .contextLabel:first-of-type
    assert.equal(winner(c, byId(doc, "C1"), "border-top-right-radius"), "10%");     // .contextLabel:last-of-type
});

// ---- cascade ----

test("engine/css: matchRules orders by origin, !important, specificity, source order, inline", () => {
    const doc: DomDocument = buildDoc(h("html", {}, h("body", {}, h("p", { id: "t", class: "a", style: "color: inline; margin: 1 !important; --My-Var: x" }))));
    const el: DomElement = byId(doc, "t");
    const ss: Stylesheet[] = sheets(
        ["p { color: ua; margin: ua !important; padding: ua !important } #t { width: ua }", "ua"],
        ["p { color: user; padding: user !important; border: user !important }", "user"],
        ["#t { color: author-id; width: author; border: author !important } .a { color: author-class } p.a { color: late; color: later }", "author"],
    );
    const c: MatchContext = ctxOf(doc, ss);
    assert.equal(winner(c, el, "color"), "inline");                 // inline normal beats every author normal
    assert.equal(winner(c, el, "margin"), "ua");                     // ua !important beats inline !important
    assert.equal(winner(c, el, "padding"), "ua");                    // ua !important beats user !important
    assert.equal(winner(c, el, "border"), "user");                   // user !important beats author !important
    assert.equal(winner(c, el, "width"), "author");                  // author normal beats ua normal despite equal id
    assert.equal(winner(c, el, "--My-Var"), "x");                    // custom properties carried, case kept
    const colors: string[] = matchRules(c, el).filter((m) => m.declaration.property === "color").map((m) => m.declaration.value);
    assert.deepEqual(colors, ["ua", "user", "author-class", "late", "later", "author-id", "inline"]);
    const inline: MatchedDeclaration | undefined = matchRules(c, el).find((m) => m.origin === "inline");
    assert.equal(inline && inline.selector, undefined);
    const noInline: DomDocument = buildDoc(h("html", {}, h("p", { id: "t", class: "a" })));
    assert.equal(winner(ctxOf(noInline, ss), byId(noInline, "t"), "color"), "author-id");
    assert.equal(winner(ctxOf(doc, sheets(["p { color: imp !important }", "author"])), el, "color"), "imp");   // author !important beats inline normal
    const lone: DomDocument = buildDoc(h("p", { style: "color: b !important" }));
    assert.equal(winner(ctxOf(lone, sheets(["p { color: a !important }", "author"])), lone.root, "color"), "b");  // inline !important beats author !important
});

test("engine/css: a selector list applies once with its most specific matching member; pseudo filter", () => {
    const doc: DomDocument = buildDoc(h("html", {}, h("p", { id: "t", class: "a" })));
    const el: DomElement = byId(doc, "t");
    const c: MatchContext = ctxOf(doc, sheets(["p, .a, #t { color: x } #t.a::before { content: 'b' } p::after, p { color: y }", "author"]));
    const plain: MatchedDeclaration[] = matchRules(c, el);
    assert.equal(plain.length, 2);
    assert.deepEqual([...plain[0].specificity], [0, 0, 1]);    // p, from the later rule
    assert.equal(plain[1].selector && plain[1].selector.text, "#t");
    assert.equal(winner(c, el, "content", "before"), "'b'");
    assert.equal(winner(c, el, "color", "after"), "y");
    assert.equal(matchRules(c, el, "marker").length, 0);
    assert.ok(matchRules(c, el, "before").every((m) => m.origin !== "inline"));
});

// ---- sheet parsing and recovery ----

test("engine/css: declarations, important, case, custom properties, inline style", () => {
    const [rule] = parseSheet("P { COLOR: Red ! IMPORTANT; --Vs-X: var(--a, #FFF); content: \"a;b}\"; background: url(data:x;y) }", "author", "t", 7).rules;
    assert.equal(rule.order, 7);
    assert.deepEqual(rule.declarations, [
        { property: "color", value: "Red", important: true },
        { property: "--Vs-X", value: "var(--a, #FFF)", important: false },
        { property: "content", value: "\"a;b}\"", important: false },
        { property: "background", value: "url(data:x;y)", important: false },
    ]);
    assert.deepEqual(parseInlineStyle(" color : red ;; bad ; margin:0 !important; /* c */ width: 1ch; x: ; : y; --e: "), [
        { property: "color", value: "red", important: false },
        { property: "margin", value: "0", important: true },
        { property: "width", value: "1ch", important: false },
        { property: "--e", value: "", important: false },
    ]);
    assert.deepEqual(parseInlineStyle(""), []);
});

test("engine/css: broken CSS costs only the broken rule", () => {
    const names = (text: string): string[] => parseSheet(text, "author", "t", 0).rules.map((r) => r.selectors.map((s) => s.text).join(","));
    assert.deepEqual(names("a{color:red;;;} }} b{x:1} c{ y: 2 }"), ["a", "c"]);              // `}} b` is a bad prelude
    assert.deepEqual(names("{x:1} a{y:2}"), ["a"]);
    assert.deepEqual(names("a:hover, b..c { x: 1 } d { x: 2 }"), ["d"]);                      // invalid list drops the rule
    assert.deepEqual(names("a:hover, b { x: 1 }"), ["a:hover,b"]);                            // unsupported is still valid
    assert.deepEqual(names("@import url(x.css); @font-face { src: x } a{x:1} @keyframes k { from { x: 1 } } b{x:2}"), ["a", "b"]);
    assert.deepEqual(names("@media screen { m{x:1} } @media print { n{x:1} } @media (max-width: 600px) { o{x:1} } @media all, print { q{x:1} } @supports (x) { r{x:1} } s{x:1}"), ["m", "q", "s"]);
    const rules = parseSheet("a{ c:1; d; e:2 } b { f: 3", "author", "t", 0).rules;
    assert.deepEqual(rules.map((r) => r.declarations.map((d) => d.property)), [["c", "e"], ["f"]]);   // unclosed block closes at EOF
    assert.deepEqual(parseSheet("/* x { */ a /* y */ { b: 1 /* } */ }", "author", "t", 0).rules[0].declarations, [{ property: "b", value: "1", important: false }]);
    assert.doesNotThrow(() => parseSheet("@media { ; } ] ) ( { \" ' \\", "author", "t", 0));
    assert.equal(parseSheet("", "ua", "t", 0).rules.length, 0);
    const s: Stylesheet = parseSheet("a{x:1} b{x:2}", "user", "named", 10);
    assert.deepEqual([s.name, s.origin, s.rules.map((r) => r.order)], ["named", "user", [10, 11]]);
});

type AstRule = { type: string; selectors?: string[]; media?: string; rules?: AstRule[]; declarations?: Array<{ type: string }> };

/** Independent rule count from the `css` package AST (these sheets are clean): qualified rules incl. applying @media. */
function referenceCount(rules: AstRule[]): { applied: number; selectors: number; declarations: number } {
    let applied: number = 0;
    let selectors: number = 0;
    let declarations: number = 0;
    for (const r of rules) {
        const inner = r.type === "media" && /^\s*(only\s+)?(all|screen)\s*$/i.test(r.media || "") ? referenceCount(r.rules || []) : { applied: 0, selectors: 0, declarations: 0 };
        const own: boolean = r.type === "rule";
        applied += (own ? 1 : 0) + inner.applied;
        selectors += (own ? (r.selectors || []).length : 0) + inner.selectors;
        declarations += (own ? (r.declarations || []).filter((d) => d.type === "declaration").length : 0) + inner.declarations;
    }
    return { applied, selectors, declarations };
}

test("engine/css: styles/*.css and ua.css parse with no lost rules", () => {
    const files: string[] = readdirSync(join(process.cwd(), "styles")).filter((f: string) => f.endsWith(".css")).map((f: string) => join("styles", f));
    files.push(join(process.env.CHECKOUT_HTMLVIEW as string, "src", "engine", "style", "ua.css"));
    const counts: Record<string, number> = {};
    for (const file of files) {
        const text: string = readFileSync(resolve(process.cwd(), file), "utf8");
        const sheet: Stylesheet = parseSheet(text, "author", file, 0);
        const ast = css.parse(text, { silent: true });
        assert.equal(ast.stylesheet.parsingErrors.length, 0, file);
        const ref = referenceCount(ast.stylesheet.rules);
        assert.equal(sheet.rules.length, ref.applied, file + " rules");
        assert.equal(sheet.rules.reduce((n: number, r) => n + r.selectors.length, 0), ref.selectors, file + " selectors");
        assert.equal(sheet.rules.reduce((n: number, r) => n + r.declarations.length, 0), ref.declarations, file + " declarations");
        assert.ok(sheet.rules.every((r) => r.declarations.length > 0), file + " empty rule");
        counts[file.replace(/^.*\//, "")] = sheet.rules.length;
    }
    // pinned so a parser change that loses rules (or a sheet change) is noticed
    assert.deepEqual(counts, { "connectionsetup.css": 15, "hotspot.css": 25, "rule.css": 44, "terminal.css": 7, "theme.css": 2, "vs.css": 12, "ua.css": 87 });
});
