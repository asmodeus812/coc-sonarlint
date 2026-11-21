/* --------------------------------------------------------------------------------------------
 * Shared markup helpers of the Sonar view adapters (rule, hotspot, connection).
 * ------------------------------------------------------------------------------------------ */
"use strict";

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
