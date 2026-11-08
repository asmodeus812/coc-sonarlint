/* --------------------------------------------------------------------------------------------
 * Pure helper of the `sonarlint.view.stylesheets` setting (no coc dependency, unit-testable).
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from "path";

/** Makes a (already `workspace.expand`ed) stylesheet path absolute, relative ones against `root`. */
export function resolveSheetPath(file: string, root: string): string {
    return path.isAbsolute(file) || root === "" ? file : path.resolve(root, file);
}
