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
// Upstream sonarlint-vscode retired client-side on-demand download for this analyzer
// (SLVSCODE-1655) and no longer publishes a version pin for it in package.json, so we
// track the last known working version ourselves. binaries.sonarsource.com still serves
// it unauthenticated as of 2026-09, but this is an unofficial/deprecated distribution
// channel that could disappear or stop being updated without notice.
const CFAMILY_PLUGIN_VERSION = "6.80.0.98490";

function getOnDemandAnalyzersPath() {
    return path.resolve(util.extensionPath, "..", "sonarsource.sonarlint_ondemand-analyzers");
}

export async function maybeAddCFamilyJar(params: string[]) {
    const expectedVersion: string = CFAMILY_PLUGIN_VERSION;
    const maybeCFamilyJar = path.resolve(getOnDemandAnalyzersPath(), CFAMILY_PLUGIN_ID, expectedVersion, CFAMILY_JAR);
    // earlier versions left a folder named like the jar (see startDownloadAsync), the next download replaces it
    if (fs.existsSync(maybeCFamilyJar) && !fs.statSync(maybeCFamilyJar).isFile()) {
        fs.rmSync(maybeCFamilyJar, { recursive: true, force: true });
    }
    if (fs.existsSync(maybeCFamilyJar)) {
        params.push(maybeCFamilyJar);
        await util.extensionContext.globalState.update(lastUsedKey(CFAMILY_PLUGIN_ID, expectedVersion), DateTime.now().toMillis());
        await cleanupOldAnalyzersAsync();
    } else {
        // the download runs in the background, activation does not wait for it; a finished download asks for a reload
        startDownloadAsync(getOnDemandAnalyzersPath(), expectedVersion).catch((err) =>
            logToSonarLintOutput(`Failed to download the cfamily jar: ${(err as Error).message}`)
        );
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
            // coc runs extensions without AbortController, the cancellation token passed to the download stops it
            cancelToken.onCancellationRequested(() => {
                errorMessage = "Download aborted. Analysis of C and C++ is disabled.";
            });
            const url = `https://binaries.sonarsource.com/CommercialDistribution/${CFAMILY_PLUGIN_ID}/${CFAMILY_PLUGIN_ID}-${expectedVersion}.jar`;

            // coc's download() treats `dest` as a FOLDER and names the file itself (from the response, or a random
            // uuid), passing the jar path creates a folder of that name: download into a folder of its own, then move
            // the file it returns to the jar path
            const downloadDir = path.join(destinationDir, `.download-${process.pid}-${Date.now()}`);
            fs.mkdirSync(downloadDir, { recursive: true });

            try {
                const downloaded: string = await coc.download(
                    url,
                    {
                        dest: downloadDir,
                        onProgress: (percent: string) => {
                            progress.report({
                                message: "Downloading analyzer for the C/C++ langauges...",
                                increment: Number.parseInt(percent)
                            });
                        }
                    },
                    cancelToken
                );
                fs.rmSync(jarPath, { recursive: true, force: true });
                fs.renameSync(downloaded, jarPath);
                logToSonarLintOutput(`Downloaded the cfamily jar into ${jarPath}`);
                return true;
            } catch (err) {
                if (!cancelToken.isCancellationRequested) {
                    errorMessage = (err as Error).message;
                }
                return false;
            } finally {
                fs.rmSync(downloadDir, { recursive: true, force: true });
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
        fs.rmSync(jarPath, { recursive: true, force: true });
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
