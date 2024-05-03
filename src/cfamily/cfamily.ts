/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import * as fs from "fs";
import * as path from "path";
import { SONARLINT_CATEGORY } from "../settings/settings";
import { SonarLintDocumentation } from "../commons";

const PATH_TO_COMPILE_COMMANDS = "pathToCompileCommands";
const FULL_PATH_TO_COMPILE_COMMANDS = `${SONARLINT_CATEGORY}.${PATH_TO_COMPILE_COMMANDS}`;
const DO_NOT_ASK_ABOUT_COMPILE_COMMANDS_FLAG = "doNotAskAboutCompileCommands";
let remindMeLaterAboutCompileCommandsFlag = false;

function showMessageAndUpdateConfig(compilationDbPath: string) {
    coc.window.showInformationMessage(
        `Analysis configured. Compilation database path is set to: ${compilationDbPath}`,
    );
    const [pathForSettings, workspaceFolder] =
        tryRelativizeToWorkspaceFolder(compilationDbPath);

    if (workspaceFolder !== undefined) {
        const config = coc.workspace.getConfiguration(
            SONARLINT_CATEGORY,
            workspaceFolder.uri,
        );
        return config.update(
            PATH_TO_COMPILE_COMMANDS,
            pathForSettings,
            coc.ConfigurationTarget.WorkspaceFolder,
        );
    }
    return coc.workspace
        .getConfiguration()
        .update(
            FULL_PATH_TO_COMPILE_COMMANDS,
            pathForSettings,
            coc.ConfigurationTarget.Workspace,
        );
}

function tryRelativizeToWorkspaceFolder(
    filePath: string,
): [string, coc.WorkspaceFolder | undefined] {
    if (!path.isAbsolute(filePath)) {
        return [filePath, undefined];
    }
    for (const folder of coc.workspace.workspaceFolders || []) {
        const folderPath = coc.Uri.parse(folder.uri).fsPath;
        if (filePath.startsWith(folderPath)) {
            const pathWithVariable = `\${workspaceFolder}${filePath.replace(folderPath, "")}`;
            return [pathWithVariable, folder];
        }
    }
    return [filePath, undefined];
}

export async function configureCompilationDatabase() {
    const paths = (
        await coc.workspace.findFiles(`**/compile_commands.json`)
    ).filter((path) => fs.existsSync(path.fsPath));
    if (paths.length === 0) {
        coc.window
            .showWarningMessage(`No compilation databases were found in the workspace\n 
[How to generate compile commands](${SonarLintDocumentation.C_CPP_ANALYSIS})`);
        coc.workspace
            .getConfiguration()
            .update(
                FULL_PATH_TO_COMPILE_COMMANDS,
                undefined,
                coc.ConfigurationTarget.Workspace,
            );
    } else {
        await showCompilationDatabaseOptions(paths);
    }
}

export function notifyMissingCompileCommands(context: coc.ExtensionContext) {
    return async () => {
        if (
            (await doNotAskAboutCompileCommandsFlag(context)) ||
            remindMeLaterAboutCompileCommandsFlag
        ) {
            return;
        }
        const remindMeLaterAction = "Ask me later";
        const configureCompileCommandsAction = "Configure compile commands";
        const message = `SonarLint is unable to analyze C and C++ file(s) because there is no configured compilation 
      database.`;
        coc.window
            .showWarningMessage(
                message,
                configureCompileCommandsAction,
                remindMeLaterAction,
            )
            .then((selection) => {
                switch (selection) {
                    case configureCompileCommandsAction:
                        configureCompilationDatabase();
                        break;
                    case remindMeLaterAction:
                        remindMeLaterAboutCompileCommandsFlag = true;
                        break;
                }
            });
    };
}

async function doNotAskAboutCompileCommandsFlag(
    context: coc.ExtensionContext,
): Promise<boolean> {
    return context.workspaceState.get(
        DO_NOT_ASK_ABOUT_COMPILE_COMMANDS_FLAG,
        false,
    );
}

async function showCompilationDatabaseOptions(paths: coc.Uri[]) {
    if (paths.length === 1) {
        return showMessageAndUpdateConfig(paths[0].fsPath);
    }
    const items = paths.map((path, i) => ({
        label: path.fsPath,
        description: ``,
        index: i,
    }));
    items.sort((i1, i2) => i1.label.localeCompare(i2.label));
    const selection = await coc.window.showQuickPick(items, {
        placeholder: "Pick a compilation database",
    });
    if (selection) {
        return showMessageAndUpdateConfig(paths[selection.index].fsPath);
    }
    return undefined;
}
