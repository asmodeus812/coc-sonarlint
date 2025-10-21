/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as fse from "fs";
import * as Path from "path";
import * as coc from "coc.nvim";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import { focusResourceLocation } from "../util/util";

const SONARQUBE_MCP_INSTRUCTIONS_FILE = "sonarqube_mcp_instructions.mdc";

export async function introduceSonarQubeRulesFile(languageClient: SonarLintExtendedLanguageClient): Promise<void> {
    const userConfirmed = await askUserForConfirmation();
    if (!userConfirmed) {
        return;
    }

    const workspaceFolder = coc.workspace.getWorkspaceFolder(coc.workspace.root);
    if (!workspaceFolder) {
        coc.window.showErrorMessage("No workspace folder found. Please open a folder first.");
        return;
    }

    const cursorRulesUri = Path.join(coc.Uri.parse(workspaceFolder.uri).fsPath, ".cursor", "rules");
    const rulesFileUri = Path.join(cursorRulesUri, SONARQUBE_MCP_INSTRUCTIONS_FILE);

    try {
        try {
            fse.existsSync(cursorRulesUri);
        } catch {
            fse.mkdirSync(cursorRulesUri);
        }

        try {
            fse.existsSync(rulesFileUri);
            const overwrite = await coc.window.showWarningMessage(
                `The ${SONARQUBE_MCP_INSTRUCTIONS_FILE} file already exists. Do you want to overwrite it?`,
                "Overwrite"
            );
            if (overwrite !== "Overwrite") {
                return;
            }
        } catch {
            // file does not exist, proceed to create it
        }

        const rulesFileResponse = await languageClient.getMCPRulesFileContent("cursor");

        fse.writeFileSync(rulesFileUri, Buffer.from(rulesFileResponse.content, "utf8"));

        const document = await coc.workspace.openTextDocument(rulesFileUri);
        await focusResourceLocation(document.uri);

        coc.window.showInformationMessage("SonarQube MCP Server rules file created.");
    } catch (error) {
        coc.window.showErrorMessage(`Failed to create rules file: ${(error as Error).message}`);
    }
}

export async function openSonarQubeRulesFile(): Promise<void> {
    try {
        const workspaceFolder = coc.workspace.root && coc.workspace.getWorkspaceFolder(coc.workspace.root);
        if (!workspaceFolder) {
            coc.window.showErrorMessage("No workspace folder found. Please open a folder first.");
            return;
        }

        const rulesFileUri = getCursorRulesFileUri(coc.Uri.parse(workspaceFolder.uri));

        try {
            fse.existsSync(rulesFileUri);
            const document = await coc.workspace.openTextDocument(rulesFileUri);
            await focusResourceLocation(document.uri);
        } catch {
            const action = await coc.window.showWarningMessage(
                "SonarQube rules file not found. Would you like to create one?",
                "Create Rules File"
            );
            if (action === "Create Rules File") {
                await coc.commands.executeCommand("SonarLint.IntroduceSonarQubeRulesFile");
            }
        }
    } catch (error) {
        coc.window.showErrorMessage(`Error opening SonarQube rules file: ${(error as Error).message}`);
    }
}

export async function isSonarQubeRulesFileConfigured(): Promise<boolean> {
    const workspaceFolder = coc.workspace.getWorkspaceFolder(coc.workspace.root);
    if (!workspaceFolder) {
        return false;
    }

    const rulesFileUri = getCursorRulesFileUri(coc.Uri.parse(workspaceFolder.uri));
    try {
        return fse.existsSync(rulesFileUri);
    } catch {
        return false;
    }
}

function getCursorRulesFileUri(workspaceFolderUri: coc.Uri): string {
    return Path.join(workspaceFolderUri.fsPath, ".cursor", "rules", SONARQUBE_MCP_INSTRUCTIONS_FILE);
}

async function askUserForConfirmation(): Promise<boolean> {
    await coc.window.showInformationMessage(
        `Would you like to create a SonarQube MCP Server instructions for AI agents?, This will create a '${SONARQUBE_MCP_INSTRUCTIONS_FILE}' file in your workspace folder.`
    );
    return true;
}
