import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parse, HTMLElement as HNode, NodeType } from "node-html-parser";
import type { Node as PNode } from "node-html-parser";
import { activate, controlFor, emptyFormState, findControls, fromSelection, initialFormState, isChecked, toSelection, toggle, toggleLinks } from "@htmlview/engine/interact/index";
import type { FormState } from "@htmlview/engine/interact/index";
import type { DomDocument, DomElement, DomNode } from "@htmlview/engine/dom";
import { diffPrepass, DIFF_CLASSES } from "../../src/rules/diffPrepass";
import { loadFixture } from "../fixtures";
import { byId } from "@htmlview-tests/testutil";

/** Test-only DomDocument builder (the real parser belongs to the dom part): node-html-parser tree → engine dom. */
function buildDoc(html: string): DomDocument {
    const nodes: DomNode[] = [];
    const parent: number[] = [];
    const walk = (n: PNode, p: number): DomNode | undefined => {
        let out: DomNode | undefined;
        if (n instanceof HNode) {
            const el: DomElement = { type: "element", id: nodes.length, tag: (n.rawTagName ?? "html").toLowerCase(), attrs: {}, classList: [], children: [] };
            nodes.push(el);
            parent.push(p);
            const attrs: Record<string, string> = {};
            for (const [k, v] of Object.entries(n.attributes)) {
                attrs[k.toLowerCase()] = v;
            }
            // `checked` without value is a present attribute
            if (/\schecked(\s|>|=|\/)/i.test(n.rawAttrs ? ` ${n.rawAttrs} ` : "") && attrs.checked === undefined) {
                attrs.checked = "";
            }
            (el as unknown as { attrs: Record<string, string> }).attrs = attrs;
            (el as unknown as { children: DomNode[] }).children = n.childNodes.map((c) => walk(c, el.id)).filter((c): c is DomNode => c !== undefined);
            out = el;
        } else if (n.nodeType === NodeType.TEXT_NODE) {
            out = { type: "text", id: nodes.length, text: n.rawText };
            nodes.push(out);
            parent.push(p);
        }
        return out;
    };
    const root = walk(parse(html), -1) as DomElement;
    return { root, body: root, nodes, parent, styles: [] };
}

const tabs = (): DomDocument => buildDoc(loadFixture("rule-tabs-contexts"));

test("interact: findControls scans a document once, a new document again", () => {
    const doc = tabs();
    assert.equal(findControls(doc), findControls(doc));
    assert.notEqual(findControls(tabs()), findControls(doc));
});

test("interact: findControls lists radios in order, grouped by name, labels linked by for", () => {
    const doc = tabs();
    const controls = findControls(doc);
    assert.deepEqual(controls.map((c) => [c.kind, c.key, c.group]), [
        ["radio", "tab-0", "tabs"],
        ["radio", "context-0", "contextualTabs"],
        ["radio", "context-1", "contextualTabs"],
    ]);
    assert.deepEqual(controls.map((c) => c.defaultChecked), [true, false, true]);
    const label = doc.nodes[controls[1].labels[0]] as DomElement;
    assert.equal(controls[1].labels.length, 1);
    assert.deepEqual([label.tag, label.attrs.for], ["label", "context-0"]);
});

test("interact: initial state comes from the checked attributes", () => {
    const state = initialFormState(tabs());
    assert.deepEqual(toSelection(state), { tabs: "tab-0", contextualTabs: "context-1" });
    assert.equal(state.checkboxes.size, 0);
});

test("interact: toggling a context moves only its group and never mutates the old state", () => {
    const doc = tabs();
    const s0 = initialFormState(doc);
    const s1 = toggle(doc, s0, "context-0");
    assert.deepEqual(toSelection(s1), { tabs: "tab-0", contextualTabs: "context-0" });
    assert.deepEqual(toSelection(s0), { tabs: "tab-0", contextualTabs: "context-1" });
    assert.equal(isChecked(doc, s1, byId(doc, "context-0")), true);
    assert.equal(isChecked(doc, s1, byId(doc, "context-1")), false);
    assert.equal(isChecked(doc, s1, byId(doc, "tab-0")), true);
    assert.equal(toggle(doc, s1, "nope"), s1);
});

test("interact: radio groups are exclusive and a checked radio stays checked", () => {
    const doc = buildDoc('<input type="radio" name="g" id="a" checked><input type="radio" name="g" id="b" checked><input type="radio" name="h" id="c">');
    const s = initialFormState(doc);
    assert.deepEqual(toSelection(s), { g: "b" });
    const t = toggle(doc, toggle(doc, s, "a"), "c");
    assert.deepEqual(toSelection(t), { g: "a", h: "c" });
    assert.equal(isChecked(doc, t, byId(doc, "b")), false);
    assert.deepEqual(toSelection(toggle(doc, t, "c")), { g: "a", h: "c" });
});

test("interact: checkboxes are keyed by id (or name) and flip", () => {
    const doc = buildDoc('<input type="checkbox" id="x" checked><input type="checkbox" name="n"><input type="text" id="t">');
    const s = initialFormState(doc);
    assert.equal(s.checkboxes.get("x"), true);
    assert.equal(s.checkboxes.get("n"), false);
    const f = toggle(doc, toggle(doc, s, "x"), "n");
    assert.equal(f.checkboxes.get("x"), false);
    assert.equal(f.checkboxes.get("n"), true);
    assert.equal(s.checkboxes.get("x"), true);
    assert.equal(isChecked(doc, f, byId(doc, "x")), false);
    assert.equal(isChecked(doc, f, byId(doc, "t")), false);
});

test("interact: label to control resolves via for and via nesting", () => {
    const doc = buildDoc('<label for="a" id="l1">A</label><input type="radio" name="g" id="a"><label id="l2"><input type="checkbox" id="c"> C</label><label for="zzz" id="l3">Z</label><label id="l4"><input type="radio" id="r"></label>');
    assert.equal(controlFor(doc, byId(doc, "l1"))?.key, "a");
    assert.equal(controlFor(doc, byId(doc, "a"))?.key, "a");
    assert.equal(controlFor(doc, byId(doc, "l2"))?.key, "c");
    assert.equal(controlFor(doc, byId(doc, "l3")), undefined);
    assert.equal(controlFor(doc, byId(doc, "l4"))?.kind, "radio");
});

test("interact: fromSelection overlays valid radios on the markup state", () => {
    const doc = tabs();
    assert.deepEqual(toSelection(fromSelection(doc, { contextualTabs: "context-0" })), { tabs: "tab-0", contextualTabs: "context-0" });
    assert.deepEqual(toSelection(fromSelection(doc, { contextualTabs: "bogus", other: "x" })), { tabs: "tab-0", contextualTabs: "context-1" });
});

test("interact: activate maps targets to restyle, open, jump or none", () => {
    const doc = tabs();
    const s = initialFormState(doc);
    const r = activate(doc, s, { kind: "context", contexts: "contextualTabs", key: "context-0" });
    assert.equal(r.kind, "restyle");
    assert.deepEqual(r.kind === "restyle" ? toSelection(r.state) : {}, { tabs: "tab-0", contextualTabs: "context-0" });
    assert.deepEqual(activate(doc, s, { kind: "url", href: "https://x" }), { kind: "open", href: "https://x" });
    assert.deepEqual(activate(doc, s, { kind: "anchor", id: "sec" }), { kind: "jump", id: "sec" });
    assert.deepEqual(activate(doc, s, { kind: "context", contexts: "g", key: "none" }), { kind: "none" });
});

test("interact: state converts to the view's selected record (radios only)", () => {
    const state: FormState = { radios: new Map([["tabs", "tab-why"]]), checkboxes: new Map([["c", true]]) };
    assert.deepEqual(toSelection(state), { tabs: "tab-why" });
    assert.deepEqual(toSelection(emptyFormState()), {});
});

test("interact: toggle links are the context-kind targets", () => {
    const links = toggleLinks([
        { line: 0, startCol: 0, endCol: 3, target: { kind: "context", contexts: "tabs", key: "a" } },
        { line: 1, startCol: 0, endCol: 3, target: { kind: "url", href: "u" } },
    ]);
    assert.equal(links.length, 1);
});

test("interact: diff class data is exported for the adapters", () => {
    assert.equal(DIFF_CLASSES.added, "code-added");
    assert.equal(typeof diffPrepass, "function");
});
