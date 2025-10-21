/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

"use strict";

import * as coc from "coc.nvim";
import { ExtendedClient } from "../lsp/protocol";
import { SonarLintExtendedLanguageClient } from "../lsp/client";

export class NewCodeDefinitionService {
    private static _instance: NewCodeDefinitionService;
    private readonly newCodeDefinitionByFolderUriCache = new Map<string, NewCodeDefinition>();

    static init(_context: coc.ExtensionContext, _client: SonarLintExtendedLanguageClient): void {
        NewCodeDefinitionService._instance = new NewCodeDefinitionService();
    }

    static get instance(): NewCodeDefinitionService {
        return NewCodeDefinitionService._instance;
    }

    updateNewCodeDefinitionForFolderUri(params: ExtendedClient.SubmitNewCodeDefinitionParams) {
        this.newCodeDefinitionByFolderUriCache.set(params.folderUri, {
            isSupported: params.isSupported,
            newCodeDefinitionOrMessage: params.newCodeDefinitionOrMessage
        });
    }

    updateNewCodeStatusBarItem(textEditor?: coc.TextEditor) {
        const _uri: string | undefined = textEditor?.document?.uri;
        if (_uri === undefined || _uri == null) {
            return;
        }
        const scheme = coc.Uri.parse(_uri).scheme;
        if (scheme !== "file") {
            return;
        }
        const workspaceFolder = coc.workspace.getWorkspaceFolder(_uri);
        if (!workspaceFolder) {
            return;
        }
    }
}

export function getFocusOnNewCodeFromConfiguration() {
    return coc.workspace.getConfiguration("sonarlint").get("focusOnNewCode", false);
}

export interface NewCodeDefinition {
    newCodeDefinitionOrMessage: string;
    isSupported: boolean;
}
