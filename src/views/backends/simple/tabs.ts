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
    const found: Array<{ id: string; name: string; parent: DomElement; tabs: Tab[]; complete: boolean }> = [];
    labels.forEach((label: DomElement): void => {
        const radio = radioOf(label, byId);
        const name = radio !== undefined ? radio.attrs["name"] ?? "" : "";
        const parent = label.parent;
        if (radio !== undefined && name !== "" && parent !== undefined) {
            let entry = found.find((g): boolean => g.name === name && g.parent === parent);
            if (entry === undefined) {
                entry = { id: `${name}#${found.length}`, name, parent, tabs: [], complete: true };
                found.push(entry);
            }
            const panel = panelAfter(label);
            if (panel === undefined) {
                entry.complete = false;
            } else {
                entry.tabs.push({ radio, label, panel });
            }
        }
    });
    return found
        .filter((g): boolean => g.complete && g.tabs.length > 0)
        .map((g): TabGroup => {
            let checked = 0;
            g.tabs.forEach((t: Tab, i: number): void => {
                if ("checked" in t.radio.attrs) {
                    checked = i;
                }
            });
            return { id: g.id, tabs: g.tabs, checked };
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
