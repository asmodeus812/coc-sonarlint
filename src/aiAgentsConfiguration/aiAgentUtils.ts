/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";

export enum IDE {
    VSCODE = "vscode",
    CURSOR = "cursor",
    WINDSURF = "windsurf"
}

export function isCopilotInstalledAndActive(): boolean {
    const copilotExtension = coc.extensions.getExtensionById("coc-copilot");
    return copilotExtension?.isActive || false;
}

export function getCurrentIdeWithMCPSupport(): IDE | undefined {
    return IDE.VSCODE;
}
