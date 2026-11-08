/**
 * The public contract of the coc-htmlview extension, as far as coc-sonarlint uses it: what its `activate()` returns.
 * A copy of coc-htmlview's `src/api.ts`; there is no compile-time dependency between the two extensions. `version`
 * bumps only on breaking changes, an extension reporting another version is not used.
 */

/** The API version this copy describes. */
export const HTMLVIEW_API_VERSION = 1;

/** Rewrites the HTML before it is parsed. */
export type HtmlPrepass = (html: string) => string;

/** How one code language is highlighted. */
export interface LanguageEntry {
    treesitter?: string;
    hljs?: string;
}

/** Extra language keys: an entry, an alias to a generic name, or `""` for no highlighting. */
export type LanguageOptions = Record<string, LanguageEntry | string>;

/** Why a view is refreshed. */
export type RefreshReason = "open" | "resize" | "context" | "colorscheme";

/** Where and how the view opens. */
export interface ViewSpec {
    /** Buffer name and reuse key. */
    name: string;
    /** Default `htmlview.view.mode`. */
    mode?: "split" | "float";
    /** Default `htmlview.view.splitCommand`. */
    splitCommand?: string;
    /** Reuse the buffer of the same name; default false. */
    reuse?: boolean;
    /** Statusline or float title. */
    title?: string;
}

/** Options of {@link HtmlViewApi.render}. */
export interface RenderOptions {
    /** Stylesheet file paths in cascade order; the user's `htmlview.stylesheets` are appended after these. */
    stylesheets?: string[];
    /** Runs before parsing. */
    prepass?: HtmlPrepass;
    /** Default code language. */
    lang?: string;
    /** Extra language keys. */
    languages?: LanguageOptions;
    view: ViewSpec;
}

/** A shown view. */
export interface View {
    readonly bufnr: number;
    readonly winid: number;
    refresh(reason?: RefreshReason): Promise<void>;
    close(): Promise<void>;
    readonly closed: Promise<void>;
}

/** What coc-htmlview exports. */
export interface HtmlViewApi {
    readonly version: 1;
    render(html: string, options: RenderOptions): Promise<View>;
}
