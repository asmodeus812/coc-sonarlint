import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { HTMLElement, Node, NodeType, parse } from "node-html-parser";
import { renderSimple } from "../../../../src/views/backends/simple/render";

const dir = join(process.cwd(), "tests/fixtures");
const DROPPED = new Set(["head", "script", "style", "template", "noscript", "svg", "iframe"]);

/** The words of the visible text of a node in document order: text minus dropped and hidden elements plus img alts. */
function visibleWords(node: Node, out: string[]): void {
    if (node.nodeType === NodeType.TEXT_NODE) {
        out.push(...node.text.replace(/ /g, " ").split(/\s+/).filter((w: string): boolean => w !== ""));
    } else if (node.nodeType === NodeType.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = (el.tagName ?? "").toLowerCase();
        if (!DROPPED.has(tag) && el.getAttribute("hidden") === undefined) {
            if (tag === "img" && el.getAttribute("alt")) {
                out.push(...el.getAttribute("alt")!.split(/\s+/).filter((w: string): boolean => w !== ""));
            }
            el.childNodes.forEach((c: Node): void => visibleWords(c, out));
        }
    }
}

/** The first word that is missing from `text` when searched in order, or undefined. */
function firstLost(words: string[], text: string): string | undefined {
    let pos = 0;
    let lost: string | undefined;
    for (const w of words) {
        if (lost === undefined) {
            const at = text.indexOf(w, pos);
            if (at < 0) {
                lost = w;
            } else {
                pos = at + w.length;
            }
        }
    }
    return lost;
}

function check(html: string, width: number): void {
    const words: string[] = [];
    visibleWords(parse(html.replace(/<![a-z][^>]*>/gi, ""), { comment: false, blockTextElements: { script: true, style: true } }), words);
    const text = renderSimple(html, { width, allPanels: true }).lines.join("\n").replace(/ /g, " ");
    assert.equal(firstLost(words, text), undefined);
}

for (const name of readdirSync(dir).filter((n: string): boolean => n.endsWith(".html"))) {
    test(`no content lost in ${name}`, () => {
        check(readFileSync(join(dir, name), "utf8"), 400);
    });
}

test("no content lost in inline cases", () => {
    check('<p>a <img src="x" alt="the alt"> b</p><div hidden>no</div><p>c <!-- note --> d</p>', 80);
    check("<ul><li>one<ul><li>two</li></ul></li></ul><dl><dt>t</dt><dd>d</dd></dl><blockquote>q</blockquote>", 80);
    check("<p>日本語 é 🚀 end</p><pre>  keep\n\tx</pre>", 80);
});
