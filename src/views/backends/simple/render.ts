/**
 * The pure built-in renderer: HTML in, lines plus highlight, link, tab and anchor regions out (see `layout.ts`).
 * Parse, boxes and layout are separate layers; this module only chains them.
 */
import { buildBoxes } from "./boxes";
import { Layout, layout, LayoutOptions } from "./layout";
import { parseHtml } from "./parse";
import type { DomElement, DomNode } from "./parse";
import type { TabGroup } from "./tabs";

/** One tab group as the view needs it: its id, titles and initial selection. */
export interface TabGroupInfo {
    id: string;
    titles: string[];
    checked: number;
}

export interface Rendered extends Layout {
    groups: TabGroupInfo[];
}

function info(g: TabGroup): TabGroupInfo {
    return { id: g.id, titles: g.tabs.map((t) => textTitle(t.label)), checked: g.checked };
}

function textTitle(el: DomElement): string {
    const parts: string[] = [];
    const walk = (n: DomNode): void => {
        if (n.kind === "text") {
            parts.push(n.text);
        } else {
            n.children.forEach(walk);
        }
    };
    walk(el);
    return parts.join("").replace(/\s+/g, " ").trim();
}

/** Renders `html` at `opts.width` cells; a failure renders one error line instead of throwing. */
export function renderSimple(html: string, opts: LayoutOptions): Rendered {
    let out: Rendered;
    try {
        const { boxes, groups } = buildBoxes(parseHtml(html));
        out = { ...layout(boxes, opts), groups: groups.map(info) };
    } catch (e) {
        const msg = `[render error] ${e instanceof Error ? e.message : String(e)}`;
        out = { lines: [msg], highlights: [], links: [], tabs: [], anchors: {}, groups: [] };
    }
    return out;
}
