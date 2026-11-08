/* --------------------------------------------------------------------------------------------
 * Shared pieces of the SonarLint → htmlview adapters: escaping, the adapter result, the per-view sheet lists.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from "path";

/** The htmlview-backed SonarLint views. */
export type AdapterView = "rule" | "hotspot" | "connection";

/** What an adapter hands to htmlview's `render`: the markup, the default code language and the view kind. */
export interface ViewInput {
    /** HTML with upstream's markup classes; every server text field is escaped, server HTML content is kept. */
    html: string;
    /** Sonar language key for code blocks that name none (`RenderOptions.lang`); `""` when unknown. */
    lang: string;
    /** Which view this is, the key of {@link VIEW_SHEETS}. */
    view: AdapterView;
    /** Plain-text title (the rule name, the hotspot message, ...), for the buffer name. */
    title: string;
}

/**
 * The upstream sheets per view, in upstream's `<link>` order: rule panel `rulepanel.ts:65-68` (theme, rule,
 * hotspot, vs), hotspot panel `hotspotContextPanel.ts:61-63` (rule, hotspot, vs). Upstream has no connection
 * details panel; it gets the theme palette only. `terminal.css` (ours) follows upstream's sheets and adapts their
 * tab styling to a character grid.
 */
export const VIEW_SHEETS: Readonly<Record<AdapterView, readonly string[]>> = Object.freeze({
    rule: Object.freeze(["theme.css", "rule.css", "hotspot.css", "vs.css", "terminal.css"]),
    hotspot: Object.freeze(["rule.css", "hotspot.css", "vs.css", "terminal.css"]),
    connection: Object.freeze(["theme.css"])
});

/** The bundled sheet `name` (a file under `<extensionPath>/styles/`) as a path for htmlview's `stylesheets`. */
export function bundledSheetPath(name: string, extensionPath: string): string {
    return path.join(extensionPath, "styles", name);
}

/** The paths of the sheets `view` uses plus the bundled `extra` ones, in cascade order. */
export function sheetPaths(view: AdapterView, extensionPath: string, extra: readonly string[] = []): string[] {
    return [...VIEW_SHEETS[view], ...extra].map((name: string): string => bundledSheetPath(name, extensionPath));
}

const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
});

/** Escapes text for element content and quoted attribute values; `null`/`undefined` become `""`. */
export function escapeHtml(value: unknown): string {
    const text: string = value === undefined || value === null ? "" : String(value);
    return text.replace(/[&<>"']/g, (c: string): string => HTML_ESCAPES[c]);
}

/** `Foo` from `foo` / `FOO` (lower-cases the rest, like lodash `capitalize`). */
export function capitalize(text: string): string {
    const lower: string = text.toLocaleLowerCase("en-us");
    return lower.charAt(0).toLocaleUpperCase("en-us") + lower.slice(1);
}
