/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict"

import * as fs from 'fs'
import * as Path from "path"
import * as coc from "coc.nvim"
import { getSonarLintConfiguration } from "../settings/settings"
import { RequirementsData } from "../util/requirements"
import * as util from "../util/util"
import { logToSonarLintOutput } from 'coc-sonarlint/src/util/logging'

declare let v8debug: object
const DEBUG = typeof v8debug === "object" || util.startedInDebugMode(process)

export function languageServerCommand(
    context: coc.ExtensionContext,
    requirements: RequirementsData,
) {
    let location: string | undefined = getSonarLintConfiguration().get('ls.directory')
    location = !location || !fs.existsSync(location) ? Path.resolve(__dirname, '../') : location

    if (location) {
        location = coc.workspace.expand(location)
        if (!fs.existsSync(location)) {
            logToSonarLintOutput(
                `Sonar can not start, invalid or non existent path was detected ${location}`,
            )
            coc.window.showWarningMessage(`Sonar binaries not found, check SonarLint output`)
            return undefined
        }
    } else {
        coc.window.showWarningMessage(`Sonar binaries directory could not be resolved at all`)
        return undefined
    }

    const serverJar = Path.resolve(
        location,
        "server",
        "sonarlint-ls.jar",
    )
    const javaExecutablePath = Path.resolve(requirements.javaHome, "bin", "java")

    const params: string[] = []
    if (DEBUG) {
        params.push(
            "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000,quiet=y",
        )
        params.push("-Dsonarlint.telemetry.disabled=true")
    }
    const vmargs = getSonarLintConfiguration().get("ls.vmargs", "")
    parseVMargs(params, vmargs)
    params.push("-jar", serverJar)
    params.push("-stdio")
    params.push("-analyzers")
    params.push(Path.resolve(location, "analyzers", "sonargo.jar"))
    params.push(
        Path.resolve(location, "analyzers", "sonarjava.jar"),
    )
    params.push(Path.resolve(location, "analyzers", "sonarjs.jar"))
    params.push(Path.resolve(location, "analyzers", "sonarphp.jar"))
    params.push(
        Path.resolve(location, "analyzers", "sonarpython.jar"),
    )
    params.push(
        Path.resolve(location, "analyzers", "sonarhtml.jar"),
    )
    params.push(Path.resolve(location, "analyzers", "sonarxml.jar"))
    params.push(
        Path.resolve(location, "analyzers", "sonarcfamily.jar"),
    )
    params.push(
        Path.resolve(location, "analyzers", "sonartext.jar"),
    )
    params.push(Path.resolve(location, "analyzers", "sonariac.jar"))
    params.push(
        Path.resolve(location, "analyzers", "sonarlintomnisharp.jar"),
    )

    return {
        command: javaExecutablePath,
        args: params,
        transport: coc.TransportKind.stdio,
    }
}

export function parseVMargs(params: string[], vmargsLine: string) {
    if (!vmargsLine) {
        return
    }
    const vmargs = vmargsLine.match(/(?:[^\s"]+|"[^"]*")+/g)
    if (vmargs === null) {
        return
    }
    vmargs.forEach((arg) => {
        //remove all standalone double quotes
        arg = arg.replace(/(\\)?"/g, function($0, $1) {
            return $1 ? $0 : ""
        })
        //unescape all escaped double quotes
        arg = arg.replace(/(\\)"/g, '"')
        if (params.indexOf(arg) < 0) {
            params.push(arg)
        }
    })
}
