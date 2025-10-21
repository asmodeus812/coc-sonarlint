/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { getFileNameFromFullPath, getRelativePathFromFullPath } from "../util/uri";
import { ExtendedTreeItem } from "../util/types";

export class FindingsFileNode extends ExtendedTreeItem {
    constructor(
        public readonly fileUri: string,
        public readonly findingsCount: number,
        public readonly category?: "new" | "older"
    ) {
        super(getFileNameFromFullPath(fileUri), coc.TreeItemCollapsibleState.Expanded);

        const categorySuffix = category ? `_${category}` : "";
        this.id = `${fileUri}${categorySuffix}`;
        this.contextValue = "findingsFileGroup";
        this.resourceUri = coc.Uri.parse(fileUri);

        const specifyWorkspaceFolderName = coc.workspace.workspaceFolders?.length > 1;
        // no need to compute relative path if file is outside any workspace folder
        const workspaceFolder = coc.workspace.getWorkspaceFolder(this.resourceUri);
        this.description =
            coc.workspace.workspaceFolders && workspaceFolder
                ? getRelativePathFromFullPath(fileUri, workspaceFolder, specifyWorkspaceFolderName)
                : "";

        if (category) {
            this.tooltip = `${findingsCount} Sonar Finding(s) in ${category} code`;
        } else {
            this.tooltip = `${findingsCount} Sonar Finding(s)`;
        }
    }
}
