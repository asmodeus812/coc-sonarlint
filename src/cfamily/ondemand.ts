/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import * as fs from "fs";
import { DateTime } from "luxon";
import * as path from "path";

import { logToSonarLintOutput } from "../util/logging";
import * as util from "../util/util";

// Comparing a `DateTime` in the past with `diffNow` returns a negative number
const PLUGIN_MAX_AGE_MONTHS = -2;

const CFAMILY_PLUGIN_ID = "sonar-cfamily-plugin";
const CFAMILY_JAR = "sonarcfamily.jar";

function getOnDemandAnalyzersPath() {
    return path.resolve(util.extensionPath, "..", "sonarsource.sonarlint_ondemand-analyzers");
}

export async function maybeAddCFamilyJar(params: string[]) {
    const expectedVersion: string = util
        .getExtensionPackageJson()
        .jarDependencies.filter((dep: any) => dep.artifactId === CFAMILY_PLUGIN_ID)[0].version;
    const maybeCFamilyJar = path.resolve(getOnDemandAnalyzersPath(), CFAMILY_PLUGIN_ID, expectedVersion, CFAMILY_JAR);
    if (fs.existsSync(maybeCFamilyJar)) {
        params.push(maybeCFamilyJar);
        await util.extensionContext.globalState.update(lastUsedKey(CFAMILY_PLUGIN_ID, expectedVersion), DateTime.now().toMillis());
        await cleanupOldAnalyzersAsync();
    } else {
        // Async call is expected here
        await startDownloadAsync(getOnDemandAnalyzersPath(), expectedVersion);
    }
}

async function startDownloadAsync(onDemandAnalyzersPath: string, expectedVersion: string) {
    const destinationDir = path.resolve(onDemandAnalyzersPath, CFAMILY_PLUGIN_ID, expectedVersion);
    const jarPath = path.join(destinationDir, CFAMILY_JAR);

    let errorMessage = "";
    const actuallyDownloaded = await coc.window.withProgress(
        {
            title: `Downloading ${CFAMILY_PLUGIN_ID} analyzer version ${expectedVersion}`,
            cancellable: true
        },
        async (progress, cancelToken) => {
            const fetchAbort = new AbortController();
            cancelToken.onCancellationRequested(() => {
                errorMessage = "Download aborted. Analysis of C and C++ is disabled.";
                fetchAbort.abort(errorMessage);
            });
            const url = `https://binaries.sonarsource.com/CommercialDistribution/${CFAMILY_PLUGIN_ID}/${CFAMILY_PLUGIN_ID}-${expectedVersion}.jar`;

            fs.mkdirSync(destinationDir, { recursive: true });

            try {
                await coc.download(
                    url,
                    {
                        dest: jarPath,
                        onProgress: (percent: string) => {
                            progress.report({
                                message: "Downloading analyzer for the C/C++ langauges...",
                                increment: Number.parseInt(percent)
                            });
                        }
                    },
                    cancelToken
                );
                logToSonarLintOutput(`Downloaded the cfamily jar into ${jarPath}`);
                return true;
            } catch (err) {
                errorMessage = (err as Error).message;
                return false;
            }
        }
    );

    if (actuallyDownloaded) {
        const restart = await coc.window.showInformationMessage(
            `Downloaded ${CFAMILY_PLUGIN_ID} ${expectedVersion}, please reload the current window to activate it.`,
            "Reload"
        );
        if (restart === "Reload") {
            coc.commands.executeCommand("workbench.action.reloadWindow");
        }
    } else {
        // Remove partial/invalid file to avoid issues at next start
        fs.rmSync(jarPath, { force: true });
        coc.window.showErrorMessage(errorMessage);
    }
}

export function lastUsedKey(pluginId: string, version: string) {
    return `plugins[${pluginId}][${version}].lastUsed`;
}

// Exported for tests
export async function cleanupOldAnalyzersAsync(): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            fs.readdirSync(getOnDemandAnalyzersPath()).forEach(cleanupOldAnalyzerVersions);
            resolve();
        } catch (e) {
            reject(e as Error);
        }
    });
}

function cleanupOldAnalyzerVersions(pluginId: string) {
    fs.readdirSync(path.resolve(getOnDemandAnalyzersPath(), pluginId)).forEach(cleanVersionIfUnused(pluginId));
}

function cleanVersionIfUnused(pluginId: string) {
    return (version: string) => {
        const lastUsedForThisPluginAndVersion = lastUsedKey(pluginId, version);
        const lastUsed = util.extensionContext.globalState.get<number>(lastUsedForThisPluginAndVersion);
        if (lastUsed) {
            const dateTimeLastUsed = DateTime.fromMillis(lastUsed);
            // Comparing a `DateTime` in the past with `diffNow` returns a negative number
            if (dateTimeLastUsed.diffNow("months").months <= PLUGIN_MAX_AGE_MONTHS) {
                fs.rmSync(path.resolve(getOnDemandAnalyzersPath(), pluginId, version), { recursive: true, force: true });
                util.extensionContext.globalState.update(lastUsedForThisPluginAndVersion, undefined);
            }
        }
    };
}
