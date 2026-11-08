/* --------------------------------------------------------------------------------------------
 * The SonarLint side of the views: the `sonarlint.view.stylesheets` setting, the lookup of the optional coc-htmlview
 * extension, and `SonarViews.show`, the one call the commands make. A {@link DescriptionRenderer} (htmlview, or the simple fallback when
 * htmlview is unavailable) does the rendering; the error report lives here, once.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { HTMLVIEW_API_VERSION, type HtmlViewApi } from "./htmlviewApi";
import { diffPrepass } from "../rules/diffPrepass";
import { SONAR_LANGUAGES } from "../rules/languages";
import { sheetPaths, ViewInput } from "../rules/markup";
import { logToSonarLintOutput } from "./logging";
import { showSimple } from "./simpleRender";
import { resolveSheetPath } from "./viewSettings";

/** The `sonarlint.view.*` settings; where and how views open is `coc-htmlview`'s (`htmlview.*`). */
interface ViewSettings {
    stylesheets: string[];
}

/** Options of {@link SonarViews.show} (the simple renderer only uses `title`). */
export interface ShowOptions {
    /** Buffer name and reuse key (`sonarlint://rule`). */
    name: string;
    /** Statusline / float title; default the input's title. */
    title?: string;
    /** Extra bundled sheets (file names under `styles/`) appended after the view's defaults. */
    extraSheets?: string[];
}

/** Reads the current `sonarlint.view.*` settings, with their defaults. */
function viewSettings(): ViewSettings {
    const config: coc.WorkspaceConfiguration = coc.workspace.getConfiguration("sonarlint.view");
    const sheets: unknown = config.get<unknown>("stylesheets", []);
    return {
        stylesheets: Array.isArray(sheets) ? sheets.filter((s: unknown): s is string => typeof s === "string" && s !== "") : []
    };
}

/** Shows a description (the adapters' {@link ViewInput}) to the user. The one seam between the views and a renderer. */
export interface DescriptionRenderer {
    /** Renders `input` per `options`; rejects on failure (the caller, {@link SonarViews}, reports it). */
    show(input: ViewInput, options: ShowOptions): Promise<void>;
}

/** The htmlview API, as far as this file needs it. */
export type HtmlviewModule = HtmlViewApi;

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
 * it when needed) and uses its exports only when they report API version 1. Absent, failing or another version
 * yields `undefined`, and the simple renderer is used. Called lazily, on the first view.
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

/** Adapts htmlview: the view's bundled and user sheet paths, languages and diff pre-pass (the window is `htmlview.*`). */
export class HtmlviewRenderer implements DescriptionRenderer {
    constructor(
        private readonly htmlview: HtmlviewModule,
        private readonly extensionPath: string
    ) {}

    async show(input: ViewInput, options: ShowOptions): Promise<void> {
        const settings: ViewSettings = viewSettings();
        await this.htmlview.render(input.html, {
            stylesheets: [...sheetPaths(input.view, this.extensionPath, options.extraSheets), ...userSheetPaths(settings.stylesheets)],
            prepass: diffPrepass,
            lang: input.lang,
            languages: SONAR_LANGUAGES,
            view: {
                name: options.name,
                reuse: true,
                title: options.title ?? input.title
            }
        });
    }
}

/** Adapts the simple fallback: a focusable float with standard highlight groups (ignores the buffer name, sheets and settings). */
export class SimpleRenderer implements DescriptionRenderer {
    async show(input: ViewInput, options: ShowOptions): Promise<void> {
        await showSimple({ ...input, title: options.title ?? input.title });
    }
}

/** The renderer to use: htmlview when `htmlview` is available, else the simple one. */
export function createRenderer(extensionPath: string, htmlview: HtmlviewModule | undefined): DescriptionRenderer {
    return htmlview === undefined ? new SimpleRenderer() : new HtmlviewRenderer(htmlview, extensionPath);
}

/** One per extension session: what the commands call. Picks the renderer on the first show and reports failures once. */
export class SonarViews {
    private renderer: Promise<DescriptionRenderer> | undefined;

    /** `renderer` is for tests; by default coc-htmlview is looked up lazily, on the first `show`. */
    constructor(
        private readonly extensionPath: string,
        renderer?: DescriptionRenderer
    ) {
        this.renderer = renderer === undefined ? undefined : Promise.resolve(renderer);
    }

    private pick(): Promise<DescriptionRenderer> {
        if (this.renderer === undefined) {
            this.renderer = loadHtmlview().then((api: HtmlViewApi | undefined): DescriptionRenderer => createRenderer(this.extensionPath, api));
        }
        return this.renderer;
    }

    /** Shows `input` (htmlview: in the buffer `options.name`, split or float per `htmlview.*`). Never throws. */
    async show(input: ViewInput, options: ShowOptions): Promise<void> {
        try {
            await (await this.pick()).show(input, options);
        } catch (e) {
            const message: string = e instanceof Error ? e.message : String(e);
            logToSonarLintOutput(`cannot show ${options.name}: ${e instanceof Error ? (e.stack ?? message) : message}`);
            void coc.window.showErrorMessage(`SonarLint: cannot show ${options.name}: ${message}`);
        }
    }
}

/** The user's extra sheets as paths (`~` and environment variables expanded, relative paths against the workspace root); htmlview skips and logs unreadable ones. */
function userSheetPaths(files: string[]): string[] {
    return files.map((file: string): string => resolveSheetPath(coc.workspace.expand(file), coc.workspace.root));
}
