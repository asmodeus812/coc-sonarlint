/* --------------------------------------------------------------------------------------------
 * Stable tree nodes. coc's tree view remembers whether a node is expanded on the node object itself, so a data
 * provider that builds new node objects on every refresh resets every group to its default state each time the
 * tree refreshes (while findings stream in, a rule is toggled, a connection reports its status, ...). Providers
 * hand their freshly built nodes through `reuse`, which returns the object already shown for that key, updated.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { ExtendedTreeItem } from "./types";

export class StableTreeNodes {
    private readonly nodes = new Map<string, ExtendedTreeItem>();

    /**
     * The node known under `key` (default: `fresh.id`), updated with `fresh`'s label, description, tooltip, data and
     * command but keeping its expanded state; `fresh` itself when the key is new or names a node of another class.
     */
    reuse<T extends ExtendedTreeItem>(fresh: T, key: string = String(fresh.id)): T {
        const known: ExtendedTreeItem | undefined = this.nodes.get(key);
        let node: T = fresh;
        if (known !== undefined && known.constructor === fresh.constructor) {
            const state = known.collapsibleState;
            Object.assign(known, fresh);
            known.collapsibleState = state;
            // commands that pass the node itself must keep passing the shown one
            if (known.command?.arguments !== undefined) {
                known.command = { ...known.command, arguments: known.command.arguments.map((a: unknown) => (a === fresh ? known : a)) };
            }
            node = known as T;
        } else {
            this.nodes.set(key, fresh);
        }
        return node;
    }

    /** The node shown under `key`, if any. */
    get(key: string): ExtendedTreeItem | undefined {
        return this.nodes.get(key);
    }
}
