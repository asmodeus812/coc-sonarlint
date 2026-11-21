/**
 * The simple backend, used when the optional htmlview extension is not installed. The renderer lives in
 * `./simple/` (parse, boxes, layout; pure `renderSimple`); this module re-exports it and shows the result in a
 * focusable float (`SimpleBackend`) with every tab panel in order. Highlight columns are 0 based UTF-8 byte offsets,
 * which is what coc (Vim and Neovim) expects.
 */
import type { FloatFactory } from "coc.nvim";
import type { ViewBackend, ViewDescription } from "./backend";
import { renderSimple } from "./simple/render";
import { displayWidth } from "./simple/text";

export { renderSimple } from "./simple/render";
export type { Rendered, TabGroupInfo } from "./simple/render";
export type { Highlight as SimpleHighlight, Layout, LayoutOptions, LinkRegion, TabRegion } from "./simple/layout";
export { displayWidth } from "./simple/text";

/** A focusable coc float that stays open until closed (Vim and Neovim), with standard highlight groups. */
export class SimpleBackend implements ViewBackend {
    private factory: FloatFactory | undefined;

    async show(view: ViewDescription): Promise<void> {
        const coc = await import("coc.nvim"); // lazy: renderSimple stays usable without the coc runtime
        const cols = coc.workspace.env.columns;
        const rows = coc.workspace.env.lines;
        const width = Math.max(30, Math.min(100, cols - 12));
        const html = view.prepass !== undefined ? view.prepass(view.html) : view.html;
        const { lines, highlights } = renderSimple(html, { width, allPanels: true });
        if (!this.factory) {
            this.factory = coc.window.createFloatFactory({});
        }
        const widest = lines.reduce((m, l) => Math.max(m, displayWidth(l)), 0);
        await this.factory.show([{ filetype: "txt", content: lines.join("\n"), highlights: highlights.map((h) => ({ ...h })) }], {
            title: view.title,
            focusable: true,
            autoHide: false,
            close: true,
            border: [1, 1, 1, 1],
            rounded: true,
            maxWidth: Math.min(widest + 2, cols - 6),
            maxHeight: Math.max(5, rows - 8),
            modes: ["n"],
        });
    }
}
