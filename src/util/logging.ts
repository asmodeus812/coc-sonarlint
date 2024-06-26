/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict"

import * as coc from "coc.nvim"
import { isVerboseEnabled } from "../settings/settings"

let sonarlintOutput: coc.OutputChannel

export function initLogOutput(context: coc.ExtensionContext) {
    sonarlintOutput = coc.window.createOutputChannel("SonarLint")
    context.subscriptions.push(sonarlintOutput)
}

export function getLogOutput() {
    return sonarlintOutput
}

export function logToSonarLintOutput(message: string) {
    if (sonarlintOutput) {
        sonarlintOutput.appendLine(message)
    }
}

export function showLogOutput() {
    getLogOutput()?.show()
}

export function verboseLogToSonarLintOutput(message: string) {
    if (isVerboseEnabled()) {
        logToSonarLintOutput(message)
    }
}

export function logNoSubmodulesFound(repo: string, error: string) {
    verboseLogToSonarLintOutput(
        `No submodules found in '${repo}' repository. Error: ${error}`,
    )
}

export function logGitCheckIgnoredError(error: string) {
    verboseLogToSonarLintOutput(`Error when detecting ignored files: ${error}`)
}
