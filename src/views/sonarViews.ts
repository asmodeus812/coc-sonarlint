/* --------------------------------------------------------------------------------------------
 * The one call the commands make, `SonarViews.show`: describes an adapter's view (its kind's parts plus the
 * `sonarlint.view.stylesheets` setting), hands it to the backend (htmlview, else the simple one, picked on the
 * first show) and reports failures, once.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import * as path from "path";
import { logToSonarLintOutput } from "../util/logging";
import { loadBackend, type ViewBackend } from "./backends/backend";
import { BundledSheets, bundledSheets, describeView, SonarView, VIEW_KINDS } from "./kinds";

/** Makes an (already `workspace.expand`ed) stylesheet path absolute, relative ones against `root`. */
export function resolveSheetPath(file: string, root: string): string {
    return path.isAbsolute(file) || root === "" ? file : path.resolve(root, file);
}

/**
 * The current `sonarlint.view.stylesheets` as paths (`~` and environment variables expanded, relative paths
 * against the workspace root); htmlview skips and logs unreadable ones. Read per show, so changes apply next time.
 */
export function userSheetPaths(): string[] {
    const sheets: unknown = coc.workspace.getConfiguration("sonarlint.view").get<unknown>("stylesheets", []);
    const files: string[] = Array.isArray(sheets) ? sheets.filter((s: unknown): s is string => typeof s === "string" && s !== "") : [];
    return files.map((file: string): string => resolveSheetPath(coc.workspace.expand(file), coc.workspace.root));
}

/** One per extension session: what the commands call. */
export class SonarViews {
    private backend: Promise<ViewBackend> | undefined;
    private readonly bundled: BundledSheets;

    /** `backend` is for tests; by default coc-htmlview is looked up lazily, on the first `show`. */
    constructor(extensionPath: string, backend?: ViewBackend) {
        this.bundled = bundledSheets(extensionPath);
        this.backend = backend === undefined ? undefined : Promise.resolve(backend);
    }

    private pick(): Promise<ViewBackend> {
        if (this.backend === undefined) {
            this.backend = loadBackend();
        }
        return this.backend;
    }

    /** Shows `view` (htmlview: in its kind's buffer, split or float per `htmlview.*`). Never throws. */
    async show(view: SonarView): Promise<void> {
        try {
            await (await this.pick()).show(describeView(view, this.bundled, userSheetPaths()));
        } catch (e) {
            const name: string = VIEW_KINDS[view.kind].name;
            const message: string = e instanceof Error ? e.message : String(e);
            logToSonarLintOutput(`cannot show ${name}: ${e instanceof Error ? (e.stack ?? message) : message}`);
            void coc.window.showErrorMessage(`SonarLint: cannot show ${name}: ${message}`);
        }
    }
}
