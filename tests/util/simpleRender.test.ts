import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { displayWidth, renderSimple } from "../../src/util/simpleRender";

const dir = join(process.cwd(), "tests/fixtures");
const fixture = (n: string) => readFileSync(join(dir, n + ".html"), "utf8");
const render = (html: string, width = 60) => renderSimple(html, { width });

test("headings, lists and pre", () => {
    const r = render("<h2>Why</h2><p>text</p><ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><ol><li>x</li><li>y</li></ol><pre>\nif (a) {\n  b;\n}\n</pre>");
    assert.deepEqual(r.lines, ["## Why", "", "text", "", "• a", "  • b", "• c", "", "1. x", "2. y", "", "  if (a) {", "    b;", "  }"]);
    assert.ok(r.highlights.some((h) => h.lnum === 0 && h.hlGroup === "Title"));
    assert.ok(r.highlights.some((h) => h.lnum === 11 && h.hlGroup === "String"));
});

test("links, inline code, table, hr, blockquote, dropped tags", () => {
    const r = render('<p>See <a href="http://x.io">docs</a> and <code>f()</code></p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><hr><blockquote>q</blockquote><script>bad()</script><button>no</button>');
    assert.equal(r.lines[0], "See docs (http://x.io) and f()");
    assert.deepEqual(r.lines.slice(2, 4), ["A │ B", "1 │ 2"]);
    assert.ok(r.lines.includes("│ q"));
    assert.ok(!r.lines.join("\n").includes("bad"));
    assert.ok(r.highlights.some((h) => h.hlGroup === "Underlined") && r.highlights.some((h) => h.hlGroup === "Special"));
});

test("entities decoded once", () => {
    const text = render(fixture("edge-entities")).lines.join("\n");
    assert.match(text, /Arrows → and dashes — and <tags> & ampersands\./);
    assert.match(text, /stays literal as &#39;;\s+a\s+real one: '\./);
    assert.match(text, /if \(a < b && c > d\)/);
});

test("mixed li text is not duplicated", () => {
    const text = render(fixture("edge-mixed-li")).lines.join("\n");
    for (const s of ["Loose text before a paragraph", "A real paragraph inside the item.", "trailing loose text", "Only a paragraph", "inline"]) {
        assert.equal(text.split(s).length - 1, 1, s);
    }
    assert.match(text, /after a break/);
});

test("wrapping respects the width, CJK aware", () => {
    const long = "word ".repeat(40);
    for (const w of [20, 40]) {
        const r = render(`<p>${long}</p><ul><li>${long}</li></ul><p>${"漢字".repeat(20)} ${"漢字".repeat(5)}</p>`, w);
        for (const l of r.lines.filter((x) => !x.includes("漢"))) {
            assert.ok(displayWidth(l) <= w, l);
        }
    }
    assert.equal(displayWidth("漢a"), 3);
    const r = render(`<ul><li>${long}</li></ul>`, 20);
    assert.ok(r.lines.slice(1).every((l) => l.startsWith("  ")));
});

test("highlights are in range on every fixture and adapter output", () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".html"))) {
        const r = render(fixture(f.replace(/\.html$/, "")), 50);
        assert.ok(r.lines.length > 0, f);
        for (const h of r.highlights) {
            assert.ok(h.lnum >= 0 && h.lnum < r.lines.length, f);
            assert.ok(h.colStart >= 0 && h.colStart < h.colEnd && h.colEnd <= Buffer.byteLength(r.lines[h.lnum]), `${f} ${JSON.stringify(h)}`);
        }
    }
});
