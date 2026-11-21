import { test } from "node:test";
import * as assert from "node:assert/strict";
import Module from "node:module";

// coc.nvim is external at runtime: a minimal TreeItem for the node classes
class TreeItem {
    id?: string;
    description?: string;
    command?: { command: string; title: string; arguments?: unknown[] };
    constructor(
        public label: string,
        public collapsibleState: number = 0
    ) {}
}
const cocStub = { TreeItem, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 } };
const load = (Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = (request: string, ...rest: unknown[]): unknown => (request === "coc.nvim" ? cocStub : load(request, ...rest));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { StableTreeNodes } = require("../../src/util/stableTreeNodes") as typeof import("../../src/util/stableTreeNodes");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ExtendedTreeItem } = require("../../src/util/types") as typeof import("../../src/util/types");

class Group extends ExtendedTreeItem {
    constructor(id: string, count: number) {
        super(`group ${count}`, 2);
        this.id = id;
        this.description = `${count} findings`;
        this.command = { command: "open", title: "open", arguments: [this] };
    }
}
class Other extends ExtendedTreeItem {
    constructor(id: string) {
        super("other", 1);
        this.id = id;
    }
}

test("stableTreeNodes: a refresh gets the shown node back, updated, with its expanded state kept", () => {
    const nodes = new StableTreeNodes();
    const first = nodes.reuse(new Group("g", 1));
    first.collapsibleState = 1; // the user collapsed it
    const again = nodes.reuse(new Group("g", 5));
    assert.equal(again, first, "same object, so coc keeps its state");
    assert.equal(again.collapsibleState, 1);
    assert.equal(again.label, "group 5");
    assert.equal(again.description, "5 findings");
    assert.equal(again.command?.arguments?.[0], first, "the command still passes the shown node");
});

test("stableTreeNodes: explicit keys, new keys and a class change give the fresh node", () => {
    const nodes = new StableTreeNodes();
    const a = nodes.reuse(new Group("x", 1), "project:c:k");
    assert.equal(nodes.reuse(new Group("y", 2), "project:c:k"), a, "keyed by the given key, not the id");
    const fresh = new Group("new", 1);
    assert.equal(nodes.reuse(fresh), fresh);
    const other = new Other("new");
    assert.equal(nodes.reuse(other), other, "another class under the same key replaces it");
    assert.equal(nodes.get("new"), other);
});
