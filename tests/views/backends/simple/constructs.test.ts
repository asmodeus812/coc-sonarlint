import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderSimple } from "../../../../src/views/backends/simple/render";
import type { Rendered } from "../../../../src/views/backends/simple/render";

const render = (html: string, width = 40, extra: object = {}): Rendered => renderSimple(html, { width, ...extra });
const lines = (html: string, width = 40, extra: object = {}): string[] => render(html, width, extra).lines;
const fixture = (n: string): string => readFileSync(join(process.cwd(), "tests/fixtures", n + ".html"), "utf8");

test("blocks, margins and headings", () => {
    assert.deepEqual(lines("<h1>T</h1><p>a</p><p>b</p><h3>S</h3>x<div>y</div>", 30), ["◉ T", "", "a", "", "b", "", "▸ S", "", "x", "y"]);
    assert.deepEqual(lines("<h2>A</h2><h4>B</h4><h6>C</h6>"), ["◆ A", "", "▹ B", "", "• C"]);
    assert.deepEqual(lines("<p></p><p>a</p><p> </p>"), ["a"]);
    const r = render("<h2>Why</h2><p>x</p>");
    assert.ok(r.highlights.some((h) => h.lnum === 0 && h.hlGroup === "Title"));
});

test("inline wrapping with wide and combining characters", () => {
    assert.deepEqual(lines("<p>日本語のテキスト 日本語 éé abc</p>", 10), ["日本語のテ", "キスト", "日本語 e\u0301e\u0301", "abc"]);
    assert.deepEqual(lines("<p>averyveryverylongword</p>", 8), ["averyver", "yverylon", "gword"]);
    assert.deepEqual(lines("<p>a   b\n\n c\td</p>"), ["a b c d"]);
    assert.deepEqual(lines("<p>one<br>two<br></p>"), ["one", "two"]);
});

test("pre keeps leading, trailing and inner breaks and expands tabs", () => {
    assert.deepEqual(lines("<pre>\nl1\n\tx\n\nlast\n</pre>after", 20), [
        "┌──────────────────┐",
        "│ l1               │",
        "│         x        │",
        "│                  │",
        "│ last             │",
        "└──────────────────┘",
        "",
        "after",
    ]);
    const four = renderSimple("<pre>\tx</pre>", { width: 20, tabstop: 4 }).lines;
    assert.equal(four[1], "│     x            │");
    assert.deepEqual(lines("<pre>\n\nfirst blank</pre>", 20).slice(1, 3), ["│                  │", "│ first blank      │"]);
});

test("nested lists honour start, value and reversed", () => {
    const html = '<ol start="5"><li>a</li><li value="9">b</li><li>c</li></ol><ol reversed><li>x</li><li>y</li><li>z</li></ol><ol reversed start="10"><li>x</li><li>y</li></ol>';
    assert.deepEqual(lines(html, 30), [" 5. a", " 9. b", "10. c", "", "3. x", "2. y", "1. z", "", "10. x", " 9. y"]);
    assert.deepEqual(lines("<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>"), [" • a", "    ◦ b", "       ▪ c"]);
    assert.deepEqual(lines('<ol type="a"><li>q</li></ol><ol type="I"><li>r</li></ol>'), ["a. q", "", "I. r"]);
    assert.deepEqual(lines("<ul><li>a<li>b</ul>"), [" • a", " • b"]);
    assert.deepEqual(lines("<ul><li>c<p>para</p></li></ul>"), [" • c", "", "   para"]);
});

test("tables: colspan, wrapping and nesting", () => {
    assert.deepEqual(lines('<table><tr><th colspan="2">Head</th></tr><tr><td>a</td><td>b</td></tr></table>', 30), ["┌───────┐", "│ Head  │", "│ a │ b │", "└───┴───┘"]);
    assert.deepEqual(lines("<table><tr><td>aaa bbb ccc ddd eee fff ggg</td><td>x</td></tr></table>", 20), [
        "┌──────────────┬───┐",
        "│ aaa bbb ccc  │ x │",
        "│ ddd eee fff  │   │",
        "│ ggg          │   │",
        "└──────────────┴───┘",
    ]);
    assert.deepEqual(lines("<table><tr><td><table><tr><td>i1</td><td>i2</td></tr></table></td><td>o</td></tr></table>", 30), [
        "┌─────────────┬───┐",
        "│ ┌────┬────┐ │ o │",
        "│ │ i1 │ i2 │ │   │",
        "│ └────┴────┘ │   │",
        "└─────────────┴───┘",
    ]);
    assert.deepEqual(lines("<table><thead><tr><th>H</th></tr></thead><tr><td>x</td></tr></table>").length > 3, true);
});

test("tables whose columns do not fit are stacked", () => {
    const out = lines("<table><tr><th>Alpha</th><th>Beta</th><th>Gamma</th></tr><tr><td>aaaaaaaa</td><td>bbbbbbbb</td><td>cccccccc</td></tr></table>", 12);
    assert.deepEqual(out, [" Alpha", " Beta", " Gamma", "────────────", " aaaaaaaa", " bbbbbbbb", " cccccccc"]);
    assert.ok(out.every((l) => !l.includes("┌")));
});

test("right aligned cells size to their content", { skip: "known gap: align and text-align are not applied by the built-in renderer" }, () => {
    const out = lines('<table><tr><td align="right">1</td><td>name</td></tr><tr><td align="right">100</td><td>n2</td></tr></table>', 30);
    assert.equal(out[1], "│   1 │ name │");
});

test("tab groups: groups, regions and the selection", () => {
    const html = fixture("rule-tabs-contexts");
    const r = render(html, 60);
    assert.deepEqual(r.groups, [
        { id: "tabs#0", titles: ["Title"], checked: 0 },
        { id: "contextualTabs#1", titles: ["Servlet", "JSP"], checked: 1 },
    ]);
    assert.deepEqual(r.lines.slice(0, 5), ["┌───────┐", "│ Title │", "─".repeat(60), "  Servlet   JSP", " " + "─".repeat(58)]);
    assert.ok(r.lines.join("\n").includes("context 2") && !r.lines.join("\n").includes("context 1"));
    assert.deepEqual(
        r.tabs.map((t) => [t.group, t.index, t.lnum, t.colStart, t.colEnd]),
        [["tabs#0", 0, 1, 4, 9], ["contextualTabs#1", 0, 3, 2, 9], ["contextualTabs#1", 1, 3, 12, 15]],
    );
    const other = render(html, 60, { selected: { "contextualTabs#1": 0 } });
    assert.ok(other.lines.join("\n").includes("context 1") && !other.lines.join("\n").includes("context 2"));
    assert.deepEqual(other.tabs, r.tabs);
    assert.deepEqual(other.lines.slice(0, 3), r.lines.slice(0, 3));
});

test("tab groups: checked picks the initial selection and allPanels shows every panel", () => {
    const tabs = (checked: string): string =>
        `<div><input type="radio" name="g" id="a" ${checked === "a" ? "checked" : ""}><label for="a">One</label><div>pa</div>` +
        `<input type="radio" name="g" id="b" ${checked === "b" ? "checked" : ""}><label for="b">Two</label><div>pb</div></div>`;
    assert.deepEqual(lines(tabs("a"), 30), ["┌─────┐", "│ One │  Two", "─".repeat(30), " pa"]);
    assert.deepEqual(lines(tabs("b"), 30), ["      ┌─────┐", " One  │ Two │", "─".repeat(30), " pb"]);
    assert.equal(render(tabs("b"), 30).groups[0].checked, 1);
    assert.equal(render(tabs(""), 30).groups[0].checked, 0);
    assert.deepEqual(lines(tabs("a"), 30, { allPanels: true }), ["One", "", "pa", "", "Two", "", "pb"]);
    assert.deepEqual(lines(tabs("a"), 30, { selected: { "g#0": 1 } }).slice(3), [" pb"]);
});

test("links and anchors data", () => {
    const r = render('<p>See <a href="#x">here</a> and <a href="http://y">y</a></p><h2 id="x">X</h2>');
    assert.deepEqual(r.lines, ["See here and y", "", "◆ X"]);
    assert.deepEqual(r.links, [
        { lnum: 0, colStart: 4, colEnd: 8, href: "#x" },
        { lnum: 0, colStart: 13, colEnd: 14, href: "http://y" },
    ]);
    assert.deepEqual(r.anchors, { x: 2 });
    assert.ok(r.highlights.some((h) => h.lnum === 0 && h.colStart === 4 && h.colEnd === 8 && h.hlGroup === "Underlined"));
    const wide = render('<p>日本 <a href="/z">語</a></p>');
    assert.deepEqual(wide.links, [{ lnum: 0, colStart: 7, colEnd: 10, href: "/z" }]);
    const wrapped = render('<p><a href="/w">aaa bbb ccc</a></p>', 8);
    assert.deepEqual(wrapped.links.map((l) => [l.lnum, l.colStart, l.colEnd]), [[0, 0, 7], [1, 0, 3]]);
});

test("details, unknown inline tags and entities", () => {
    assert.deepEqual(lines("<details open><summary>Sum</summary><p>body</p></details>", 30), ["▾ Sum", "", "body"]);
    assert.deepEqual(lines("<details><summary>Closed</summary>inner</details>", 30), ["▾ Closed", "inner"]);
    assert.deepEqual(lines("<p>a <foo>unk</foo> <b>b</b><i>i</i> &amp; &lt;x&gt; &copy; &#65; &#x42;</p>"), ["a unk bi & <x> © A B"]);
    assert.deepEqual(lines("<p>one<custom-tag>two</custom-tag></p>"), ["onetwo"]);
    assert.match(lines(fixture("edge-entities"), 80).join("\n"), /Arrows → and dashes — and <tags> & ampersands\./);
    assert.deepEqual(lines('<p>x <img src="a.png" alt="pic"> y</p>'), ["x [pic] y"]);
    assert.deepEqual(lines("<p>x <script>bad()</script><style>p{}</style> y</p>"), ["x y"]);
});

test("empty, malformed and huge input", () => {
    assert.deepEqual(lines(""), []);
    assert.deepEqual(lines("   \n "), []);
    assert.deepEqual(lines("<p>unclosed <b>bold <i>x"), ["unclosed bold x"]);
    assert.deepEqual(lines("</p></div>text"), ["text"]);
    assert.deepEqual(lines("<table><td>x</table>y"), ["┌───┐", "│ x │", "└───┘", "y"]);
    assert.deepEqual(lines("<<<>>>"), ["<<<>>>"]);
    assert.deepEqual(lines("<!doctype html><p>a</p>"), ["a"]);
    const start = Date.now();
    const big = renderSimple("<p>" + "word ".repeat(100000) + "</p><ul>" + "<li>x</li>".repeat(10000) + "</ul>", { width: 80 });
    assert.ok(big.lines.length > 10000);
    const deep = renderSimple("<div>".repeat(5000) + "deep" + "</div>".repeat(5000), { width: 80 });
    assert.deepEqual(deep.lines, ["deep"]);
    assert.ok(Date.now() - start < 5000);
});
