import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import type { Color, StyledElement, StyledNode, StyledTree, StyleEnv } from "@htmlview/engine/style/index";
import type { ThemeKind } from "@htmlview/types";
import { defaultHostVars } from "@htmlview/engine/style/host";
import { computeStyles, parseSheets } from "@htmlview/engine/style/index";
import { parseDocument } from "@htmlview/engine/dom";
import { emptyFormState } from "@htmlview/engine/interact";
import type { FormState } from "@htmlview/engine/interact";

function render(html: string, css: string = "", kind: ThemeKind = "dark", state: FormState = emptyFormState(), extra: string[] = []): StyledTree {
    const sources = extra
        .map((n: string) => ({ name: n, text: fs.readFileSync(path.join(process.cwd(), "styles", n), "utf8"), origin: "author" as const }))
        .concat(css ? [{ name: "test.css", text: css, origin: "author" as const }] : []);
    const env: StyleEnv = { themeKind: kind, vars: defaultHostVars };
    return computeStyles(parseDocument(html), parseSheets(sources), env, state);
}

function all(tree: StyledTree): StyledElement[] {
    const out: StyledElement[] = [];
    const walk = (el: StyledElement): void => {
        out.push(el);
        el.children.filter((c: StyledNode): c is StyledElement => c.kind === "element").forEach(walk);
    };
    walk(tree.root);
    return out;
}

/** The element with `id` (or the first with tag `id`). */
function el(tree: StyledTree, id: string): StyledElement {
    const els: StyledElement[] = all(tree);
    const found: StyledElement | undefined = els.find((e: StyledElement) => e.element.attrs.id === id) || els.find((e: StyledElement) => e.element.tag === id);
    assert.ok(found, "no element " + id);
    return found;
}

const hex = (h: string, alpha: number = 1): Color => ({ hex: h, alpha });

test("engine/style: parseSheets puts the UA sheet first and chains rule order", () => {
    const sheets = parseSheets([{ name: "a.css", text: "p{color:red} q{color:blue}", origin: "author" }, { name: "b.css", text: "b{x:y}", origin: "user" }]);
    assert.deepEqual(sheets.map((s) => [s.name, s.origin]), [["ua.css", "ua"], ["a.css", "author"], ["b.css", "user"]]);
    const orders: number[] = sheets.flatMap((s) => s.rules.map((r) => r.order));
    assert.deepEqual(orders, orders.slice().sort((a, b) => a - b));
    assert.equal(new Set(orders).size, orders.length);
});

test("engine/style: inheritance, initial values and CSS-wide keywords", () => {
    const t = render('<div id="d"><p id="p"><span id="s">x</span></p><i id="i">y</i></div>', "#d{color:#ff0000;margin:2em 0;white-space:nowrap} #s{margin:inherit} #i{color:initial;white-space:unset}");
    assert.deepEqual(el(t, "s").style.color, hex("#ff0000"));
    assert.equal(el(t, "p").style.whiteSpace, "nowrap");
    assert.equal(el(t, "i").style.whiteSpace, "nowrap");
    assert.equal(el(t, "s").style.margin.top, 1, "inherit takes the parent p's 1em margin");
    assert.deepEqual(el(t, "i").style.color, { group: "HtmlViewHostCanvas", attr: "fg" });
    assert.equal(el(t, "d").style.margin.top, 2);
    assert.equal(el(t, "i").style.display, "inline");
});

test("engine/style: theme.css palettes follow the body class (light and dark)", () => {
    const html = '<span id="c" class="impact-high">x</span><span id="b" class="severity-blocker">y</span>';
    const dark = render(html, "", "dark", emptyFormState(), ["theme.css", "rule.css"]);
    const light = render(html, "", "light", emptyFormState(), ["theme.css", "rule.css"]);
    assert.ok(dark.root.children.length > 0);
    assert.deepEqual(el(dark, "c").style.color, hex("#fda29b"));
    assert.deepEqual(el(dark, "c").style.backgroundColor, hex("#fda29b", 0.2));
    assert.deepEqual(el(dark, "c").style.border.top.color, hex("#fda29b"));
    assert.deepEqual(el(light, "c").style.color, hex("#b42318"));
    assert.deepEqual(el(light, "c").style.backgroundColor, hex("#fef3f2"));
    assert.deepEqual(el(light, "b").style.color, hex("#801b14"));
    assert.ok(el(light, "body").element.classList.includes("vscode-light"));
    const hc = render(html, "", "high-contrast", emptyFormState(), ["theme.css", "rule.css"]);
    assert.ok(el(hc, "body").element.classList.includes("vscode-high-contrast"));
    assert.deepEqual(el(hc, "c").style.color, { var: "--vscode-editor-foreground", attr: "fg" }, "no palette: the var is invalid, colour inherits");
});

test("engine/style: var() with fallbacks, :root custom properties and host variables", () => {
    const css = ":root{--a:#00ff00;--chain:var(--vscode-textLink-foreground);--loop:var(--loop2);--loop2:var(--loop)}" +
        "#f{color:var(--nope, var(--a))} #h{color:var(--vscode-textLink-foreground, red)} #c{color:var(--chain)}" +
        "#bad{color:var(--nope)} #cyc{color:var(--loop, blue)} #m{background:var(--htmlview-mark-foreground) url(x.png)}";
    const t = render('<p id="bad"><b id="f">a</b><b id="h">b</b><b id="c">c</b><b id="cyc">d</b><b id="m">e</b></p>', css);
    assert.deepEqual(el(t, "f").style.color, hex("#00ff00"));
    assert.deepEqual(el(t, "h").style.color, { var: "--vscode-textLink-foreground", attr: "fg" });
    assert.deepEqual(el(t, "c").style.color, { var: "--vscode-textLink-foreground", attr: "fg" });
    assert.deepEqual(el(t, "bad").style.color, { var: "--vscode-editor-foreground", attr: "fg" }, "invalid at computed time: unset = inherit");
    assert.deepEqual(el(t, "cyc").style.color, hex("#0000ff"));
    assert.deepEqual(el(t, "m").style.backgroundColor, { var: "--htmlview-mark-foreground", attr: "fg" });
    assert.equal(el(t, "f").style.custom["--a"], "#00ff00");
    assert.equal(el(t, "f").style.custom["--loop"], undefined);
});

test("engine/style: literal colours, alpha, currentcolor", () => {
    const css = "#a{color:rgba(10,20,30,0.5)} #b{color:hsl(120,100%,25%)} #c{color:rebeccapurple;border:1px solid} #d{color:#abc8;background:transparent;border-right:2px dashed currentColor}";
    const t = render('<p><i id="a">a</i><i id="b">b</i><i id="c">c</i><i id="d">d</i></p>', css);
    assert.deepEqual(el(t, "a").style.color, hex("#0a141e", 0.5));
    assert.deepEqual(el(t, "b").style.color, hex("#008000"));
    assert.deepEqual(el(t, "c").style.border.left, { style: "solid", width: 1, color: hex("#663399") });
    assert.equal(el(t, "d").style.color.hasOwnProperty("hex") && (el(t, "d").style.color as { alpha: number }).alpha, 0.533);
    assert.deepEqual(el(t, "d").style.border.right.color, el(t, "d").style.color);
    assert.equal(el(t, "d").style.border.right.style, "dashed");
    assert.equal(el(t, "d").style.border.top.width, 0);
    assert.equal((el(t, "d").style.backgroundColor as { alpha: number }).alpha, 0);
});

test("engine/style: lengths to cells, box shorthands and borders", () => {
    const css = "#x{margin:16px 2ch 2em -1.5rem;padding:10px;border:none;border-top:3px double #fff} #y{padding:0.2em 0.5em;border-width:thin;border-style:solid none}";
    const t = render('<div id="x">a</div><div id="y">b</div>', css);
    assert.deepEqual(el(t, "x").style.margin, { top: 1, right: 2, bottom: 2, left: -2 });
    assert.deepEqual(el(t, "x").style.padding, { top: 1, right: 1, bottom: 1, left: 1 });
    assert.deepEqual(el(t, "x").style.border.top, { style: "double", width: 1, color: hex("#ffffff") });
    assert.equal(el(t, "x").style.border.left.width, 0);
    assert.deepEqual(el(t, "y").style.padding, { top: 0, right: 1, bottom: 0, left: 1 });
    assert.deepEqual([el(t, "y").style.border.top.width, el(t, "y").style.border.right.width], [1, 0]);
});

test("engine/style: display, blockification and flex direction", () => {
    const css = ".f{display:flex} .c{display:inline-flex;flex-direction:column} .g{display:grid} #t{display:table-cell}";
    const t = render('<div class="f"><span id="s">a</span><label id="l" class="c">b</label></div><dl class="g"><dd id="dd">x</dd></dl><div class="f"><i id="t">c</i></div>', css);
    assert.equal(el(t, "s").style.display, "block");
    assert.equal(el(t, "l").style.display, "block", "column flex computes to block");
    assert.equal(el(t, "dl").style.display, "block");
    assert.equal(el(t, "t").style.display, "block");
    assert.equal(el(t, "head").style.display, "none");
});

test("engine/style: list items, markers and counters", () => {
    const html = '<ol id="o" start="3"><li id="a">a</li><li id="b">b<ul><li id="n">n<ul><li id="nn">m</li></ul></li></ul></li><li id="v" value="10">v</li><li id="w">w</li></ol>' +
        '<ol type="a"><li id="al">x</li><li id="al2">y</li></ol><ul style="list-style:none"><li id="none">z</li></ul><ul class="s"><li id="str">s</li></ul>';
    const t = render(html, '.s{list-style-type:"\\2192  "}');
    assert.equal(el(t, "a").style.display, "list-item");
    assert.equal(el(t, "a").marker?.text, "3. ");
    assert.equal(el(t, "b").marker?.text, "4. ");
    assert.equal(el(t, "n").marker?.text, "\u25E6 ");
    assert.equal(el(t, "n").style.listStyleType, "circle");
    assert.equal(el(t, "nn").style.listStyleType, "square");
    assert.equal(el(t, "v").marker?.text, "10. ");
    assert.equal(el(t, "w").marker?.text, "11. ");
    assert.equal(el(t, "al2").marker?.text, "b. ");
    assert.equal(el(t, "none").marker, undefined);
    assert.deepEqual(el(t, "str").style.listStyleType, { string: "\u2192 " });
    assert.deepEqual(el(t, "a").marker?.paint, ["HtmlViewLiMarker"]);
    assert.deepEqual(el(t, "o").style.counterReset, [{ name: "list-item", value: 2 }]);
});

test("engine/style: ::before/::after content with counters, attr() and quotes", () => {
    const css = "body{counter-reset:sec} h2{counter-increment:sec} h2::before{content:counter(sec) \". \" attr(data-x)} h2::after{content:none}" +
        " .n::after{content:counters(sec, \".\", upper-roman)}";
    const t = render('<h2 data-x="A">x</h2><h2 id="h" data-x="B">y</h2><p class="n" id="n"><q id="q">z<q id="q2">w</q></q></p>', css);
    assert.equal(el(t, "h").before?.text, "2. B");
    assert.equal(el(t, "h").after, undefined);
    assert.equal(el(t, "n").after?.text, "II");
    assert.equal(el(t, "q").before?.text, "\u201C");
    assert.equal(el(t, "q2").before?.text, "\u2018");
    assert.equal(el(t, "q2").after?.text, "\u2019");
    assert.equal(el(t, "q").after?.text, "\u201D");
});

test("engine/style: layout hints come from ua.css and are not inherited", () => {
    const t = render('<h2 id="h"><span id="s">x</span></h2><pre id="p"><code id="c">y</code></pre><a id="a" href="u">l</a><img id="i" alt="z"><label id="l" for="r">r</label><br id="br">');
    assert.equal(el(t, "h").style.custom["--htmlview-heading"], "2");
    assert.equal(el(t, "s").style.custom["--htmlview-heading"], undefined);
    assert.equal(el(t, "p").style.custom["--htmlview-code"], "block");
    assert.equal(el(t, "c").style.custom["--htmlview-code"], undefined);
    assert.equal(el(t, "p").style.whiteSpace, "pre");
    assert.equal(el(t, "c").style.whiteSpace, "pre");
    assert.equal(el(t, "a").style.custom["--htmlview-link"], "href");
    assert.equal(el(t, "i").style.custom["--htmlview-replaced"], "alt");
    assert.equal(el(t, "l").style.custom["--htmlview-toggle"], "label");
    assert.equal(el(t, "br").style.custom["--htmlview-break"], "line");
    const off = render('<pre id="p">y</pre>', "pre{--htmlview-code:none}");
    assert.equal(el(off, "p").style.custom["--htmlview-code"], "none");
});

test("engine/style: weights, styles and decorations", () => {
    const t = render('<h1 id="h"><b id="b">x</b></h1><p><strong id="s">s</strong><em id="e">e</em><del id="d">d</del><u id="u">u</u></p><p id="t">t</p>', "#t{text-decoration:underline line-through wavy red;font:italic bold 12px serif}");
    assert.equal(el(t, "h").style.fontWeight, 700);
    assert.equal(el(t, "b").style.fontWeight, 900, "bolder over 700");
    assert.equal(el(t, "s").style.fontWeight, 700);
    assert.equal(el(t, "e").style.fontStyle, "italic");
    assert.equal(el(t, "d").style.textDecoration.lineThrough, true);
    assert.equal(el(t, "u").style.textDecoration.underline, true);
    assert.deepEqual(el(t, "t").style.textDecoration, { underline: true, lineThrough: true, overline: false, color: hex("#ff0000") });
    assert.deepEqual([el(t, "t").style.fontWeight, el(t, "t").style.fontStyle], [700, "italic"]);
});

test("engine/style: :checked from the form state drives display; document <style> is author", () => {
    const html = '<style>.tab{display:none} #r1:checked ~ #t1{display:block}</style><input type="radio" name="g" id="r0"><input type="radio" name="g" id="r1"><div class="tab" id="t1">x</div>';
    const off = render(html);
    assert.equal(el(off, "t1").style.display, "none");
    const on = render(html, "", "dark", { radios: new Map([["g", "r1"]]), checkboxes: new Map() });
    assert.equal(el(on, "t1").style.display, "block");
    assert.equal(el(on, "r1").style.custom["--htmlview-toggle"], "control");
});

test("engine/style: paint groups, group definitions and fallback chains", () => {
    const t = render('<p><span id="c" class="impact-high" style="font-weight:bold">x</span></p><pre><code id="pc">y</code></pre><h1 id="h">z</h1>', "", "dark", emptyFormState(), ["theme.css", "rule.css"]);
    const groups = new Map(t.groups.map((g) => [g.name, g]));
    assert.deepEqual(el(t, "c").paint.slice(0, 1), ["HtmlViewImpactHigh"]);
    assert.match(el(t, "c").paint[1], /^HtmlViewInline[0-9a-f]{8}$/);
    assert.deepEqual(groups.get(el(t, "c").paint[1]), { name: el(t, "c").paint[1], bold: true });
    assert.deepEqual(groups.get("HtmlViewImpactHigh"), { name: "HtmlViewImpactHigh", fg: { hex: "#fda29b" }, bg: { hex: "#fda29b", alpha: 0.2 } });
    assert.deepEqual(el(t, "pc").paint, ["HtmlViewCode", "HtmlViewPreCode"]);
    assert.deepEqual(groups.get("HtmlViewPreCode")?.bg, { hex: "#000000", alpha: 0 });
    assert.deepEqual(groups.get("HtmlViewCode")?.fg, { group: "HtmlViewVscodeTextPreformatForeground", attr: "fg", fallback: ["@markup.raw", "Special", "String"] });
    assert.deepEqual(el(t, "h").paint, ["HtmlViewH1"], "a selector list member and a later rule of the same text share one group");
    assert.deepEqual(groups.get("HtmlViewH1")?.bold, false, "rule.css h1 {font-weight: 500} is the later rule of that selector");
    assert.deepEqual(groups.get("HtmlViewHostBorder"), { name: "HtmlViewHostBorder", link: "FloatBorder", fallback: ["WinSeparator", "NonText"], only: "fg" });
    assert.deepEqual(groups.get("HtmlViewHostLinkUrl"), { name: "HtmlViewHostLinkUrl", link: "@markup.link.url", fallback: ["Underlined", "Directory"] });
    assert.deepEqual(groups.get("HtmlViewVscodeTextLinkForeground"), { name: "HtmlViewVscodeTextLinkForeground", link: "HtmlViewHostLinkUrl" });
    const names: string[] = t.groups.map((g) => g.name);
    assert.ok(names.indexOf("HtmlViewHostCanvas") < names.indexOf("HtmlViewImpactHigh"));
    for (const e of all(t)) {
        for (const g of e.paint) {
            assert.ok(groups.has(g), "paint group defined: " + g);
        }
    }
    assert.equal(el(t, "h").before?.text, "\u25C9 ");
});

test("engine/style: hljs token rules define groups although no element matches them", () => {
    const tree = render("<p>x</p>", ".hljs-number{color:#123456} .hljs-a, .hljs-b{font-weight:700} div .hljs-c{color:red}");
    const group = (name: string) => tree.groups.find((g) => g.name === name);
    assert.deepEqual(group("HtmlViewHljsNumber")?.fg, { hex: "#123456" });
    assert.equal(group("HtmlViewHljsA")?.bold, true);
    assert.equal(group("HtmlViewHljsB")?.bold, true);
    assert.equal(group("HtmlViewDivHljsC"), undefined);
});
