/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict"

import * as coc from "coc.nvim"
import * as fs from "fs"
import * as path from "path"
import {isNotificationEnabled, updateCompileCommandsPath, updateNotificationDisabled} from "../settings/settings"
import {SonarLintDocumentation} from "../commons"

let remindMeLaterAboutCompileCommandsFlag = false
let userSelectingCompileCommandsChoice = false

function showMessageAndUpdateConfig(compilationDbPath: string) {
    coc.window.showInformationMessage(
        `Analysis configured. Compilation database path is set to: ${compilationDbPath}`,
    )
    const [pathForSettings, _] = tryRelativizeToWorkspaceFolder(compilationDbPath)
    updateCompileCommandsPath(pathForSettings)
}

function tryRelativizeToWorkspaceFolder(filePath: string): [string, coc.WorkspaceFolder | undefined] {
    if (!path.isAbsolute(filePath)) {
        return [filePath, undefined]
    }
    for (const folder of coc.workspace.workspaceFolders || []) {
        const folderPath = coc.Uri.parse(folder.uri).fsPath
        if (filePath.startsWith(folderPath)) {
            const pathWithVariable = `\${workspaceFolder}${filePath.replace(folderPath, "")}`
            return [pathWithVariable, folder]
        }
    }
    return [filePath, undefined]
}

export async function configureCompilationDatabase() {
    const paths = (await coc.workspace.findFiles(`**/compile_commands.json`)).filter((path) => fs.existsSync(path.fsPath))
    if (paths.length === 0) {
        coc.window.showWarningMessage(`No compilation databases were found in the workspace\n [How to generate compile commands](${SonarLintDocumentation.C_CPP_ANALYSIS})`)
        updateCompileCommandsPath(undefined)
    } else {
        await showCompilationDatabaseOptions(paths)
    }
}

export function notifyMissingCompileCommands() {
    return async () => {
        if (userSelectingCompileCommandsChoice || (isNotificationEnabled() !== true) || remindMeLaterAboutCompileCommandsFlag) {
            return
        }
        userSelectingCompileCommandsChoice = true
        const remindMeLaterAction = "Ask me later again"
        const doNotAskGlobally = "Never ask or prompt me again"
        const doNotAskForThisWorkspace = "Do not ask for this workspace"
        const configureCompileCommandsAction = "Configure compile commands now"
        const message = `SonarLint might be unable to analyze C and C++ file(s) because there is no configured compilation database.`
        const selection = await coc.window
            .showWarningMessage(
                message,
                configureCompileCommandsAction,
                remindMeLaterAction,
                doNotAskForThisWorkspace,
                doNotAskGlobally
            )
        switch (selection) {
            case configureCompileCommandsAction:
                configureCompilationDatabase()
                break
            case remindMeLaterAction:
                remindMeLaterAboutCompileCommandsFlag = true
                break
            case doNotAskForThisWorkspace:
                updateNotificationDisabled(false, undefined);
                break
            case doNotAskGlobally:
                updateNotificationDisabled(false, coc.ConfigurationTarget.Global);
                break
        }
        userSelectingCompileCommandsChoice = false
    }
}

async function showCompilationDatabaseOptions(paths: coc.Uri[]) {
    if (paths.length === 1) {
        return showMessageAndUpdateConfig(paths[0].fsPath)
    }
    const items = paths.map((path, i) => ({
        label: path.fsPath,
        description: ``,
        index: i,
    }))
    items.sort((i1, i2) => i1.label.localeCompare(i2.label))
    const selection = await coc.window.showQuickPick(items, {
        placeholder: "Pick a compilation database source",
    })
    if (selection) {
        return showMessageAndUpdateConfig(paths[selection.index].fsPath)
    }
    return undefined
}
