/* --------------------------------------------------------------------------------------------
 * The backend seam: a fully described view in, a shown view out. Backends know nothing about Sonar views; the
 * view layer (`../sonarViews`) decides the sheets, the pre-pass and the languages.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { ExtensionLookup, HtmlviewBackend, loadHtmlview } from "./htmlview";
import type { HtmlPrepass, HtmlViewApi, LanguageOptions } from "./htmlviewApi";
import { SimpleBackend } from "./simple";

/** Everything a backend needs to show one view. */
export interface ViewDescription {
    /** Buffer name and reuse key (`sonarlint://rule`). */
    name: string;
    /** Statusline or float title. */
    title: string;
    html: string;
    /** Stylesheet paths in cascade order. */
    stylesheets: readonly string[];
    /** Rewrites the HTML before it is parsed; none when absent. */
    prepass?: HtmlPrepass;
    /** Default code language; `""` when unknown. */
    lang: string;
    /** Extra language keys. */
    languages?: LanguageOptions;
}

/** Shows a {@link ViewDescription}; rejects on failure (the caller reports it). */
export interface ViewBackend {
    show(view: ViewDescription): Promise<void>;
}

/** The htmlview backend when its API is available, else the simple one. */
export function createBackend(htmlview: HtmlViewApi | undefined): ViewBackend {
    return htmlview === undefined ? new SimpleBackend() : new HtmlviewBackend(htmlview);
}

/** Looks coc-htmlview up (see {@link loadHtmlview}) and creates the backend to use. */
export async function loadBackend(extensions?: ExtensionLookup): Promise<ViewBackend> {
    return createBackend(await loadHtmlview(extensions));
}
