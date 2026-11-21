/**
 * HTML to a light DOM: elements with lower-case tags and attributes, text with entities decoded. Content a browser
 * never renders is dropped here (`head`, `script`, `style`, `template`, `noscript`, `svg`, `[hidden]`, comments).
 * Fix-ups: the single line break right after `<pre>`/`<textarea>`/`<listing>` is removed, as browsers do; implied end
 * tags the parser misses (`<li>a<li>b`, `<p>x<ul>`, `<td>a<td>b`, `<tr>` in `<tr>`) close their element; content
 * nested deeper than {@link MAX_DEPTH} is kept as plain text of its deepest element.
 */
import { HTMLElement, Node, parse, TextNode } from "node-html-parser";

export interface DomText {
    kind: "text";
    text: string;
}

export interface DomElement {
    kind: "element";
    tag: string;
    attrs: Record<string, string>;
    children: DomNode[];
    parent: DomElement | undefined;
}

export type DomNode = DomText | DomElement;

/** Elements whose content is never shown. */
const DROPPED: Set<string> = new Set(["head", "script", "style", "template", "noscript", "svg", "math-annotation", "iframe", "object", "embed", "video", "audio", "canvas", "title", "meta", "link", "base"]);
/** Elements whose first line break is not content. */
const LEADING_NEWLINE: Set<string> = new Set(["pre", "textarea", "listing"]);

export const MAX_DEPTH = 200;

/** Blocks that close an open `<p>`. */
const CLOSES_P: Set<string> = new Set(["address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul", "li", "dt", "dd", "tr", "td", "th", "tbody", "thead", "tfoot", "caption"]);
/** Per open element, the direct children that close it (an implied end tag). */
const CLOSERS: Record<string, Set<string>> = {
    p: CLOSES_P,
    li: new Set(["li"]),
    dt: new Set(["dt", "dd"]),
    dd: new Set(["dt", "dd"]),
    td: new Set(["td", "th", "tr", "tbody", "thead", "tfoot"]),
    th: new Set(["td", "th", "tr", "tbody", "thead", "tfoot"]),
    tr: new Set(["tr", "tbody", "thead", "tfoot"]),
    thead: new Set(["tbody", "tfoot"]),
    tbody: new Set(["tbody", "tfoot", "thead"]),
    option: new Set(["option", "optgroup"]),
};

/**
 * Applies implied end tags below `el`: a child that closes `el` is cut off with everything after it, and the cut
 * tail is returned for the parent to insert after `el`.
 */
function closeImplied(el: DomElement): DomNode[] {
    let tail: DomNode[] = [];
    const closers: Set<string> | undefined = CLOSERS[el.tag];
    let i = 0;
    while (i < el.children.length && tail.length === 0) {
        const c = el.children[i];
        if (c.kind === "element" && closers !== undefined && closers.has(c.tag)) {
            tail = el.children.splice(i);
        } else {
            if (c.kind === "element") {
                const cut = closeImplied(c);
                cut.forEach((n: DomNode): void => {
                    if (n.kind === "element") {
                        n.parent = el;
                    }
                });
                el.children.splice(i + 1, 0, ...cut);
            }
            i++;
        }
    }
    return tail;
}

function lowerAttrs(el: HTMLElement): Record<string, string> {
    const out: Record<string, string> = {};
    const raw: Record<string, string> = el.attributes;
    for (const k of Object.keys(raw)) {
        out[k.toLowerCase()] = raw[k];
    }
    return out;
}

function convert(node: Node, parent: DomElement, depth: number): DomNode | undefined {
    let out: DomNode | undefined;
    if (node instanceof TextNode) {
        out = node.text.length > 0 ? { kind: "text", text: node.text } : undefined;
    } else if (node instanceof HTMLElement) {
        const tag = (node.rawTagName ?? "").toLowerCase();
        const attrs = lowerAttrs(node);
        if (tag !== "" && (DROPPED.has(tag) || "hidden" in attrs)) {
            out = undefined;
        } else if (depth >= MAX_DEPTH) {
            out = { kind: "text", text: node.text };
        } else if (tag === "") {
            const el: DomElement = { kind: "element", tag: "span", attrs: {}, children: [], parent };
            fill(el, node, depth + 1);
            out = el;
        } else {
            const el: DomElement = { kind: "element", tag, attrs, children: [], parent };
            fill(el, node, depth + 1);
            out = el;
        }
    }
    return out;
}

function fill(el: DomElement, node: HTMLElement, depth: number): void {
    for (const child of node.childNodes) {
        const c = convert(child, el, depth);
        if (c !== undefined) {
            el.children.push(c);
        }
    }
    const first = el.children[0];
    if (LEADING_NEWLINE.has(el.tag) && first !== undefined && first.kind === "text") {
        first.text = first.text.replace(/^\r?\n/, "");
    }
}

/** Parses `html` into a root element (tag `#root`); never throws (unparsable input gives its text). */
export function parseHtml(html: string): DomElement {
    const root: DomElement = { kind: "element", tag: "#root", attrs: {}, children: [], parent: undefined };
    try {
        const doc = parse(html, { lowerCaseTagName: true, comment: false, parseNoneClosedTags: true, blockTextElements: { script: true, style: true } });
        fill(root, doc, 0);
        closeImplied(root);
    } catch (e) {
        root.children = [{ kind: "text", text: html.replace(/<[^>]*>/g, " ") }];
    }
    return root;
}

/** Concatenated text of a node, as parsed. */
export function textOf(node: DomNode): string {
    let out: string;
    if (node.kind === "text") {
        out = node.text;
    } else {
        out = node.children.map(textOf).join("");
    }
    return out;
}

/** The class tokens of an element. */
export function classes(el: DomElement): string[] {
    return (el.attrs["class"] ?? "").split(/\s+/).filter((c: string): boolean => c !== "");
}
