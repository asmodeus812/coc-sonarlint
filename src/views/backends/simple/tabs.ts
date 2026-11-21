/**
 * Tab groups of the radio + label + panel pattern (`<input type=radio name=g id=x checked><label for=x>Title</label>
 * <section>panel</section>`), detected generically: a `label` whose `for` names a radio input, or that wraps one,
 * belongs to that radio's `name` group among the same parent; the label's next element sibling that is neither an
 * input nor a label is its panel. A group whose labels do not all have a panel is not recognised (its elements then
 * render in place, so nothing is lost).
 */
import type { DomElement, DomNode } from "./parse";

export interface Tab {
    radio: DomElement;
    label: DomElement;
    panel: DomElement;
}

export interface TabGroup {
    /** Unique id, `${name}#${n}` in document order. */
    id: string;
    name: string;
    /** The element holding the group's labels. */
    parent: DomElement;
    tabs: Tab[];
    /** Index of the initially selected tab: the last `checked` radio, else 0. */
    checked: number;
}

/** Per element of a recognised group (radio, label or panel), its group. */
export type TabIndex = Map<DomElement, TabGroup>;

function elements(nodes: DomNode[]): DomElement[] {
    return nodes.filter((n: DomNode): boolean => n.kind === "element") as DomElement[];
}

function isRadio(el: DomElement): boolean {
    return el.tag === "input" && (el.attrs["type"] ?? "").toLowerCase() === "radio";
}

function walk(el: DomElement, visit: (el: DomElement) => void): void {
    visit(el);
    elements(el.children).forEach((c: DomElement): void => walk(c, visit));
}

/** The radio a label controls: by `for`, else the first wrapped radio. */
function radioOf(label: DomElement, byId: Map<string, DomElement>): DomElement | undefined {
    const target = label.attrs["for"] !== undefined ? byId.get(label.attrs["for"]) : undefined;
    let radio: DomElement | undefined = target !== undefined && isRadio(target) ? target : undefined;
    if (radio === undefined && label.attrs["for"] === undefined) {
        walk(label, (e: DomElement): void => {
            if (radio === undefined && isRadio(e)) {
                radio = e;
            }
        });
    }
    return radio;
}

function panelAfter(label: DomElement): DomElement | undefined {
    const siblings = label.parent !== undefined ? elements(label.parent.children) : [];
    const rest = siblings.slice(siblings.indexOf(label) + 1);
    const next = rest.find((e: DomElement): boolean => e.tag !== "input");
    return next !== undefined && next.tag !== "label" ? next : undefined;
}

/** Detects the tab groups below `root`, in document order. */
export function detectTabs(root: DomElement): TabGroup[] {
    const byId: Map<string, DomElement> = new Map();
    const labels: DomElement[] = [];
    walk(root, (e: DomElement): void => {
        if (e.attrs["id"] !== undefined && !byId.has(e.attrs["id"])) {
            byId.set(e.attrs["id"], e);
        }
        if (e.tag === "label") {
            labels.push(e);
        }
    });
    const pending: Map<string, { name: string; parent: DomElement; tabs: Tab[]; complete: boolean }> = new Map();
    const order: string[] = [];
    let n = 0;
    labels.forEach((label: DomElement): void => {
        const radio = radioOf(label, byId);
        const name = radio !== undefined ? radio.attrs["name"] ?? "" : "";
        if (radio !== undefined && name !== "" && label.parent !== undefined) {
            const parent: DomElement = label.parent;
            let key = order.find((k: string): boolean => pending.get(k)!.name === name && pending.get(k)!.parent === parent);
            if (key === undefined) {
                key = `${name}#${n}`;
                n++;
                order.push(key);
                pending.set(key, { name, parent, tabs: [], complete: true });
            }
            const entry = pending.get(key)!;
            const panel = panelAfter(label);
            if (panel === undefined) {
                entry.complete = false;
            } else {
                entry.tabs.push({ radio, label, panel });
            }
        }
    });
    return order
        .map((id: string) => ({ id, entry: pending.get(id)! }))
        .filter((g): boolean => g.entry.complete && g.entry.tabs.length > 0)
        .map((g): TabGroup => {
            const tabs = g.entry.tabs;
            let checked = 0;
            tabs.forEach((t: Tab, i: number): void => {
                if ("checked" in t.radio.attrs) {
                    checked = i;
                }
            });
            return { id: g.id, name: g.entry.name, parent: g.entry.parent, tabs, checked };
        });
}

/** Indexes the radios, labels and panels of `groups`. */
export function indexTabs(groups: TabGroup[]): TabIndex {
    const index: TabIndex = new Map();
    groups.forEach((g: TabGroup): void => {
        g.tabs.forEach((t: Tab): void => {
            index.set(t.radio, g);
            index.set(t.label, g);
            index.set(t.panel, g);
        });
    });
    return index;
}
