/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    commands,
    ConfigurationTarget,
    WorkspaceConfiguration,
    window,
    workspace,
} from "coc.nvim";

let currentConfig: WorkspaceConfiguration;

export const SONARLINT_CATEGORY = "sonarlint";
export const VERBOSE_LOGS = "output.showVerboseLogs";

export function getSonarLintConfiguration(): WorkspaceConfiguration {
    return workspace.getConfiguration(SONARLINT_CATEGORY);
}

export function isVerboseEnabled(): boolean {
    return getCurrentConfiguration()?.get(VERBOSE_LOGS, false);
}

export function enableVerboseLogs() {
    getCurrentConfiguration()?.update(
        VERBOSE_LOGS,
        true,
        ConfigurationTarget.Global,
    );
    window.showInformationMessage("Verbose logging enabled.");
}

export function loadInitialSettings() {
    currentConfig = getSonarLintConfiguration();
}

export function getCurrentConfiguration() {
    return currentConfig;
}

export function onConfigurationChange() {
    return workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("sonarlint")) {
            return;
        }
        const newConfig = getSonarLintConfiguration();

        const sonarLintLsConfigChanged = hasSonarLintLsConfigChanged(
            currentConfig,
            newConfig,
        );

        if (sonarLintLsConfigChanged) {
            const msg =
                "SonarLint Language Server configuration changed, please restart VS Code.";
            const action = "Restart Now";
            const restartId = "workbench.action.reloadWindow";
            currentConfig = newConfig;
            window.showWarningMessage(msg, action).then((selection) => {
                if (action === selection) {
                    commands.executeCommand(restartId);
                }
            });
        }
    });
}

function hasSonarLintLsConfigChanged(
    oldConfig: WorkspaceConfiguration,
    newConfig: WorkspaceConfiguration,
) {
    return (
        !configKeyEquals("ls.javaHome", oldConfig, newConfig) ||
        !configKeyEquals("ls.vmargs", oldConfig, newConfig)
    );
}

function configKeyEquals(
    key: string,
    oldConfig: WorkspaceConfiguration,
    newConfig: WorkspaceConfiguration,
) {
    return oldConfig.get(key) === newConfig.get(key);
}
