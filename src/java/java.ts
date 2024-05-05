/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict"

import CompareVersions from "compare-versions"
import * as coc from "coc.nvim"
import { SonarLintExtendedLanguageClient } from "../lsp/client"
import { GetJavaConfigResponse } from "../lsp/protocol"
import { logToSonarLintOutput } from "../util/logging"

let classpathChangeListener: coc.Disposable | undefined
let serverModeListener: coc.Disposable | undefined
let javaApiTooLowAlreadyLogged = false
let javaServerInLightWeightModeAlreadyLogged = false

/*
 Possible startup modes for the Java extension's language server
 See https://github.com/redhat-developer/vscode-java/blob/5642bf24b89202acf3911fe7a162b6dbcbeea405/src/settings.ts#L198
 */
export enum ServerMode {
    STANDARD = "Standard",
    LIGHTWEIGHT = "LightWeight",
    HYBRID = "Hybrid",
}

export function installClasspathListener(
    languageClient: SonarLintExtendedLanguageClient,
) {
    const extension = getJavaExtension()
    if (!extension) {
        coc.window.showWarningMessage(`Unable to find any compliant java extension installed in the coc runtime`)
        return
    }
    if (extension?.isActive) {
        if (!classpathChangeListener) {
            const extensionApi = extension.exports
            if (extensionApi && isJavaApiRecentEnough(extensionApi.apiVersion)) {
                const onDidClasspathUpdate: coc.Event<coc.Uri> =
                    extensionApi.onDidClasspathUpdate
                classpathChangeListener = onDidClasspathUpdate(function(uri) {
                    logToSonarLintOutput(`Detected classpath change ${uri}`)
                    languageClient.didClasspathUpdate(uri)
                })
                logToSonarLintOutput(`Installed classpath listener for java`)
            }
        }
    } else if (classpathChangeListener) {
        classpathChangeListener.dispose()
        classpathChangeListener = undefined
    }
}

function newServerModeChangeListener(
    languageClient: SonarLintExtendedLanguageClient,
) {
    return (serverMode: ServerMode) => {
        if (serverMode !== ServerMode.LIGHTWEIGHT) {
            // Reset state of LightWeight mode warning
            javaServerInLightWeightModeAlreadyLogged = false
        }
        languageClient.didJavaServerModeChange(serverMode)
        logToSonarLintOutput(`Detected server mode change ${serverMode}`)
    }
}

export function installServerModeChangeListener(
    languageClient: SonarLintExtendedLanguageClient,
) {
    const extension = getJavaExtension()
    if (extension?.isActive) {
        if (!serverModeListener) {
            const extensionApi = extension.exports
            if (
                extensionApi &&
                isJavaApiRecentEnough(extensionApi.apiVersion) &&
                extensionApi.onDidServerModeChange
            ) {
                const onDidServerModeChange: coc.Event<ServerMode> =
                    extensionApi.onDidServerModeChange
                serverModeListener = onDidServerModeChange(
                    newServerModeChangeListener(languageClient),
                )
            }
            logToSonarLintOutput(`Installed server mode listener for java`)
        }
    } else if (serverModeListener) {
        serverModeListener.dispose()
        serverModeListener = undefined
    }
}

function isJavaApiRecentEnough(apiVersion: string): boolean {
    if (CompareVersions.compare(apiVersion, "0.4", ">=")) {
        return true
    }
    if (!javaApiTooLowAlreadyLogged) {
        logToSonarLintOutput(
            `SonarLint requires coc-java extension 0.56 or greater to enable analysis of Java files`,
        )
        javaApiTooLowAlreadyLogged = true
    }
    return false
}

export async function getJavaConfig(
    languageClient: SonarLintExtendedLanguageClient,
    fileUri: string,
): Promise<GetJavaConfigResponse | undefined> {
    const extension = getJavaExtension()
    try {
        if (!extension) {
            coc.window.showWarningMessage(`Unable to find any compliant java extension installed in the coc runtime`)
            return
        }
        const extensionApi = await extension?.activate()
        if (extensionApi && isJavaApiRecentEnough(extensionApi.apiVersion)) {
            installClasspathListener(languageClient)
            installServerModeChangeListener(languageClient)
            if (extensionApi.serverMode === ServerMode.LIGHTWEIGHT) {
                return javaConfigDisabledInLightWeightMode()
            }
            const isTest: boolean = await extensionApi.isTestFile(fileUri)
            const COMPILER_COMPLIANCE_SETTING_KEY =
                "org.eclipse.jdt.core.compiler.compliance"
            const VM_LOCATION_SETTING_KEY = "org.eclipse.jdt.ls.core.vm.location"
            const projectSettings: { [name: string]: string } =
                await extensionApi.getProjectSettings(fileUri, [
                    COMPILER_COMPLIANCE_SETTING_KEY,
                    VM_LOCATION_SETTING_KEY,
                ])
            const sourceLevel = projectSettings[COMPILER_COMPLIANCE_SETTING_KEY]
            const vmLocation = projectSettings[VM_LOCATION_SETTING_KEY]
            const classpathResult = await extensionApi.getClasspaths(fileUri, {
                scope: isTest ? "test" : "runtime",
            })

            return {
                projectRoot: classpathResult.projectRoot,
                sourceLevel,
                classpath: classpathResult.classpaths,
                isTest,
                vmLocation,
            }
        }
    } catch (error) {
        coc.window.showErrorMessage(JSON.stringify(error))
    }
}

function javaConfigDisabledInLightWeightMode() {
    if (!javaServerInLightWeightModeAlreadyLogged) {
        logToSonarLintOutput(
            `Java analysis is disabled in LightWeight mode. Please check java.server.launchMode in user settings`,
        )
        javaServerInLightWeightModeAlreadyLogged = true
    }
    return undefined
}

function getJavaExtension(): coc.Extension<any> | undefined {
    const java = coc.extensions.getExtensionById("coc-java")
    if (!java || java == null || java === undefined) {
        return coc.extensions.getExtensionById("coc-java-dev")
    }
    return java
}
