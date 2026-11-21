/* --------------------------------------------------------------------------------------------
 * The Sonar view kinds: what an adapter produces ({@link SonarView}) and what each kind brings to it (buffer name,
 * bundled sheets, pre-pass, languages), turned into a backend's {@link ViewDescription} by {@link describeView}.
 * Pure (no coc dependency).
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from "path";
import type { ViewDescription } from "./backends/backend";
import type { HtmlPrepass, LanguageOptions } from "./backends/htmlviewApi";
import { diffPrepass } from "./diffPrepass";
import { SONAR_LANGUAGES } from "./languages";

/** The Sonar views. */
export type ViewKind = "rule" | "hotspot" | "connection" | "connectionSetup";

/** What an adapter produces: the markup and the parts that depend on the data. */
export interface SonarView {
    kind: ViewKind;
    /** HTML with upstream's markup classes; every server text field is escaped, server HTML content is kept. */
    html: string;
    /** Sonar language key for code blocks that name none; `""` when unknown. */
    lang: string;
    /** Statusline or float title. */
    title: string;
}

/** What a view kind brings, the same for every view of that kind. */
export interface ViewKindSpec {
    /** Buffer name and reuse key. */
    name: string;
    /** Bundled sheets (file names under `styles/`) in cascade order. */
    sheets: readonly string[];
    /** The diff pre-pass for views with code diffs. */
    prepass?: HtmlPrepass;
    /** Sonar language keys, for views with code. */
    languages?: LanguageOptions;
}

/**
 * The kinds. The sheets follow upstream's `<link>` order: rule panel `rulepanel.ts:65-68` (theme, rule, hotspot,
 * vs), hotspot panel `hotspotContextPanel.ts:61-63` (rule, hotspot, vs); `terminal.css` (ours) adapts them to a
 * character grid. Upstream has no connection panels; they get the theme palette only, and no pre-pass.
 */
export const VIEW_KINDS: Readonly<Record<ViewKind, ViewKindSpec>> = Object.freeze({
    rule: Object.freeze({
        name: "sonarlint://rule",
        sheets: Object.freeze(["theme.css", "rule.css", "hotspot.css", "vs.css", "terminal.css"]),
        prepass: diffPrepass,
        languages: SONAR_LANGUAGES
    }),
    hotspot: Object.freeze({
        name: "sonarlint://hotspot",
        sheets: Object.freeze(["rule.css", "hotspot.css", "vs.css", "terminal.css"]),
        prepass: diffPrepass,
        languages: SONAR_LANGUAGES
    }),
    connection: Object.freeze({
        name: "sonarlint://connection",
        sheets: Object.freeze(["theme.css"])
    }),
    connectionSetup: Object.freeze({
        name: "sonarlint://connection-setup",
        sheets: Object.freeze(["theme.css", "connectionsetup.css"])
    })
});

/** The bundled sheet paths of every kind. */
export type BundledSheets = Readonly<Record<ViewKind, readonly string[]>>;

/** The bundled sheet paths of every kind, under `<extensionPath>/styles/`; static, so built once. */
export function bundledSheets(extensionPath: string): BundledSheets {
    const paths: Partial<Record<ViewKind, readonly string[]>> = {};
    for (const kind of Object.keys(VIEW_KINDS) as ViewKind[]) {
        paths[kind] = Object.freeze(VIEW_KINDS[kind].sheets.map((name: string): string => path.join(extensionPath, "styles", name)));
    }
    return Object.freeze(paths as Record<ViewKind, readonly string[]>);
}

/** The backend's description of `view`: its kind's name, sheets (then `userSheets`), pre-pass and languages. */
export function describeView(view: SonarView, bundled: BundledSheets, userSheets: readonly string[]): ViewDescription {
    const spec: ViewKindSpec = VIEW_KINDS[view.kind];
    return {
        name: spec.name,
        title: view.title,
        html: view.html,
        stylesheets: [...bundled[view.kind], ...userSheets],
        prepass: spec.prepass,
        lang: view.lang,
        languages: spec.languages
    };
}
