/** Replaces htmlview's `open` for the golden dump: records the view options (the refresh hook) instead of opening a window. */
import type { Neovim } from "coc.nvim";
import type { View, ViewOptions } from "@htmlview/view/index";
export * from "@htmlview/view/index";

export const captured: { options?: ViewOptions } = {};

export async function open(_nvim: Neovim, opts: ViewOptions): Promise<View> {
    captured.options = opts;
    return {} as View;
}
