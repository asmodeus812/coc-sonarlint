/**
 * The simple backend, used when the optional htmlview extension is not installed. The renderer lives in
 * `./simple/` (parse, boxes, layout; pure `renderSimple`) and the view in `./simple/show.ts` (a scratch buffer in a
 * float or split, browser-like tabs, links and keys, Vim and Neovim).
 */
import type { ViewBackend, ViewDescription } from "./backend";
import { SimpleView, ViewHost } from "./simple/show";

export { renderSimple } from "./simple/render";
export { displayWidth } from "./simple/text";

/** coc's workspace and the SonarLint output as the view's host (coc is loaded lazily). */
async function cocHost(): Promise<ViewHost> {
    const coc = await import("coc.nvim");
    const { logToSonarLintOutput } = await import("../../util/logging");
    return {
        nvim: coc.workspace.nvim,
        registerLocalKeymap: (bufnr, mode, lhs, fn, opts) => coc.workspace.registerLocalKeymap(bufnr, mode, lhs, fn, opts),
        registerAutocmd: (autocmd) => coc.workspace.registerAutocmd(autocmd),
        openResource: (uri) => coc.workspace.openResource(uri),
        log: (message) => logToSonarLintOutput(message),
    };
}

/** Shows views in the built-in renderer's scratch buffer; `host` defaults to coc's. */
export class SimpleBackend implements ViewBackend {
    private view: SimpleView | undefined;

    constructor(private readonly host?: ViewHost) {}

    async show(view: ViewDescription): Promise<void> {
        if (this.view === undefined) {
            this.view = new SimpleView(this.host ?? (await cocHost()));
        }
        await this.view.show({ name: view.name, title: view.title, html: view.html, prepass: view.prepass });
    }
}
