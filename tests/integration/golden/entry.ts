/**
 * Golden dump: the full htmlview output (layout, extmarks, decorations, flattened layout, hl specs, hljs code marks,
 * selection) for the demos and every fixture, at widths 40/80/100, light and dark, Neovim and Vim, plus one context
 * switch per document. `render` runs for real; only `open` is replaced (view-shim.ts) so the refresh hook can be driven.
 */
import * as fs from "fs";
import * as path from "path";
import type { Neovim } from "coc.nvim";
import { renderOn } from "@htmlview/render";
import type { LinkTarget, RefreshRequest, RefreshResult } from "@htmlview/view";
import type { ThemeKind } from "@htmlview/types";
import { flattenVirtual, toDecorations, toExtmarks, toHlSpec } from "@htmlview/view/convert";
import { listFixtures, loadFixture } from "../../fixtures";
import { diffPrepass } from "../../../src/rules/diffPrepass";
import { SONAR_LANGUAGES } from "../../../src/rules/languages";
import { sheetPaths } from "../../../src/rules/markup";
import type { AdapterView } from "../../../src/rules/markup";
import { captured } from "./view-shim";

/** `view: undefined` renders with no upstream sheets (only the built-in base and the document's own styles). */
interface Input { name: string; html: string; view: AdapterView | undefined; lang: string }

const outdir: string = path.resolve(process.argv[2] ?? ".cache/golden/cur");
const inputs: Input[] = [
    { name: "demo", html: loadFixture("demo"), view: "rule", lang: "java" },
    { name: "demo-rich", html: loadFixture("demo-rich"), view: undefined, lang: "" },
    ...listFixtures().filter((f: string): boolean => !f.startsWith("demo")).map((f: string): Input => ({ name: "fixture-" + f.replace(/\.html$/, ""), html: loadFixture(f), view: "rule", lang: "java" }))
];

function dumpResult(result: RefreshResult): unknown {
    const layout = result.layout;
    const hl = captured.options?.highlighter;
    return {
        result,
        extmarks: toExtmarks(layout.lines, layout.marks),
        decorations: toDecorations(layout),
        flattened: flattenVirtual(layout),
        hlSpecs: result.groups.map(toHlSpec),
        codeMarks: hl !== undefined ? hl.hljs(layout.codeRegions) : []
    };
}

async function refresh(req: Omit<RefreshRequest, "selected">, selected: Record<string, string>): Promise<RefreshResult> {
    const hook = captured.options?.refresh;
    if (hook === undefined) {
        throw new Error("render did not call open");
    }
    return hook({ ...req, selected });
}

async function main(): Promise<void> {
    fs.mkdirSync(outdir, { recursive: true });
    const nvim = { eval: async (): Promise<number> => 4 } as unknown as Neovim; // a fake 'tabstop' of 4
    for (const input of inputs) {
        const out: Record<string, unknown> = {};
        for (const kind of ["light", "dark"] as ThemeKind[]) {
            for (const virtual of [true, false]) {
                captured.options = undefined;
                await renderOn(nvim, input.html, {
                    stylesheets: input.view === undefined ? [] : sheetPaths(input.view, process.cwd()), prepass: diffPrepass,
                    lang: input.lang, languages: SONAR_LANGUAGES, view: { mode: "split", name: input.name, reuse: true }
                });
                let selected: Record<string, string> = {};
                let reason: RefreshRequest["reason"] = "open";
                for (const width of [40, 80, 100]) {
                    const res: RefreshResult = await refresh({ reason, width, themeKind: kind, virtual }, selected);
                    out[`${kind}-${virtual ? "nvim" : "vim"}-${width}`] = dumpResult(res);
                    selected = res.selected ?? selected;
                    reason = "resize";
                }
                const ctx = (await refresh({ reason: "resize", width: 80, themeKind: kind, virtual }, selected)).layout.links
                    .map((l): LinkTarget => l.target)
                    .find((t: LinkTarget): boolean => t.kind === "context" && selected[t.contexts] !== t.key);
                if (ctx !== undefined) {
                    out[`${kind}-${virtual ? "nvim" : "vim"}-80-context`] = dumpResult(await refresh({ reason: "context", width: 80, themeKind: kind, virtual, target: ctx }, selected));
                }
            }
        }
        fs.writeFileSync(path.join(outdir, input.name + ".json"), JSON.stringify(out, null, 1) + "\n");
    }
    console.log(`golden: ${inputs.length} inputs -> ${outdir}`);
}

main().catch((e: unknown): void => {
    console.error(e);
    process.exit(1);
});
