/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { FindingsTreeViewItem } from "../findings/findingsTreeDataProvider";

export class AutomaticAnalysisService {
    public constructor(private readonly findingsView: coc.TreeView<FindingsTreeViewItem>) {}

    updateAutomaticAnalysisStatusBarAndFindingsViewMessage() {
        const isEnabled = coc.workspace.getConfiguration("sonarlint").get("automaticAnalysis", true);
        const status = isEnabled ? "enabled" : "disabled";
        coc.window.showInformationMessage(`Automatic analysis is ${status}.`);

        // Update findings view message
        if (isEnabled) {
            this.findingsView.message = undefined;
        } else {
            this.findingsView.message = "Automatic analysis is disabled. The findings list might not be up to date.";
        }
    }
}
