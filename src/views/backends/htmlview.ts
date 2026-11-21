/* --------------------------------------------------------------------------------------------
 * The htmlview backend: the runtime lookup of the optional coc-htmlview extension and the mapping of a view
 * description onto its `render` (where and how the window opens is `htmlview.*`).
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { logToSonarLintOutput } from "../../util/logging";
import type { ViewBackend, ViewDescription } from "./backend";
import { HTMLVIEW_API_VERSION, type HtmlViewApi, type RenderOptions } from "./htmlviewApi";

/** The id of the extension that renders the views. */
export const HTMLVIEW_EXTENSION_ID = "coc-htmlview";

/** The part of coc's extension registry {@link loadHtmlview} uses (`coc.extensions`). */
export interface ExtensionLookup {
    getExtensionById(id: string): { readonly isActive: boolean; readonly exports?: unknown; activate(): Promise<unknown> } | undefined;
}

/** Whether `api` is a coc-htmlview API this extension understands. */
function isHtmlViewApi(api: unknown): api is HtmlViewApi {
    const candidate = api as Partial<HtmlViewApi> | undefined | null;
    return candidate !== undefined && candidate !== null && candidate.version === HTMLVIEW_API_VERSION && typeof candidate.render === "function";
}

/**
 * The single availability check for htmlview: looks `coc-htmlview` up in the installed coc extensions (activating
 * it when needed) and uses its exports only when they report {@link HTMLVIEW_API_VERSION}. Absent, failing or
 * another version yields `undefined`.
 */
export async function loadHtmlview(extensions: ExtensionLookup = coc.extensions): Promise<HtmlViewApi | undefined> {
    let api: HtmlViewApi | undefined;
    try {
        const ext = extensions.getExtensionById(HTMLVIEW_EXTENSION_ID);
        const exported: unknown = ext === undefined ? undefined : ext.isActive ? ext.exports : await ext.activate();
        api = isHtmlViewApi(exported) ? exported : undefined;
    } catch (e) {
        logToSonarLintOutput(`${HTMLVIEW_EXTENSION_ID} is unavailable: ${e instanceof Error ? e.message : String(e)}`);
        api = undefined;
    }
    return api;
}

/** htmlview's render options for `view`: a reused buffer of the view's name. */
export function renderOptions(view: ViewDescription): RenderOptions {
    return {
        stylesheets: [...view.stylesheets],
        prepass: view.prepass,
        lang: view.lang,
        languages: view.languages,
        view: { name: view.name, reuse: true, title: view.title }
    };
}

/** Renders through coc-htmlview. */
export class HtmlviewBackend implements ViewBackend {
    constructor(private readonly htmlview: HtmlViewApi) {}

    async show(view: ViewDescription): Promise<void> {
        await this.htmlview.render(view.html, renderOptions(view));
    }
}
