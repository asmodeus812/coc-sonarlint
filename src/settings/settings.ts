/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";

let currentConfig: coc.WorkspaceConfiguration;

export const SONARLINT_CATEGORY = "sonarlint";
export const VERBOSE_LOGS = "output.showVerboseLogs";
export const PATH_TO_COMPILE_COMMANDS = "pathToCompileCommands";
export const NOTIFY_COMPILE_COMMANDS = "notifyMissingCompileCommands";

export function getSonarLintConfiguration(): coc.WorkspaceConfiguration {
    return coc.workspace.getConfiguration(SONARLINT_CATEGORY);
}

export function isVerboseEnabled(): boolean {
    return getCurrentConfiguration()?.get(VERBOSE_LOGS, false);
}

export function isNotificationEnabled(): boolean {
    return getSonarLintConfiguration().get(NOTIFY_COMPILE_COMMANDS, true);
}

export function updateNotificationDisabled(value: boolean, target?: coc.ConfigurationTarget | undefined) {
    getSonarLintConfiguration().update(NOTIFY_COMPILE_COMMANDS, value, target);
}

export function enableVerboseLogs() {
    getCurrentConfiguration()?.update(VERBOSE_LOGS, true, coc.ConfigurationTarget.Global);
    coc.window.showInformationMessage("Sonarlint: Verbose logging enabled.");
}

export function loadInitialSettings() {
    currentConfig = getSonarLintConfiguration();
}

export function getCurrentConfiguration() {
    return currentConfig;
}

export function onConfigurationChange() {
    return coc.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("sonarlint")) {
            return;
        }
        const newConfig = getSonarLintConfiguration();
        const sonarLintLsConfigChanged = hasSonarLintLsConfigChanged(currentConfig, newConfig);

        if (sonarLintLsConfigChanged) {
            const msg = "Sonarlint server configuration changed, please restart.";
            currentConfig = newConfig;
            coc.window.showWarningMessage(msg);
        }
    });
}

function hasSonarLintLsConfigChanged(oldConfig, newConfig) {
    return !configKeyEquals("ls.javaHome", oldConfig, newConfig) || !configKeyEquals("ls.vmargs", oldConfig, newConfig);
}

function configKeyEquals(key, oldConfig, newConfig) {
    return oldConfig.get(key) === newConfig.get(key);
}

export function shouldShowRegionSelection() {
    return getSonarLintConfiguration().get("earlyAccess.showRegionSelection", false);
}

export function isFocusingOnNewCode(): boolean {
    return getSonarLintConfiguration().get("focusOnNewCode", false);
}
