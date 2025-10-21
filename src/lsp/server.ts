/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";
import * as coc from "coc.nvim";
import { TransportKind } from "coc.nvim";
import * as Path from "path";
import { getSonarLintConfiguration } from "../settings/settings";
import { RequirementsData } from "../util/requirements";
import { startedInDebugMode } from "../util/util";

export async function languageServerCommand(context: coc.ExtensionContext, requirements: RequirementsData) {
    const serverJar = Path.resolve(context.extensionPath, "server", "sonarlint-ls.jar");
    const javaExecutablePath = Path.resolve(requirements.javaHome, "bin", "java");

    const params: string[] = [];
    if (startedInDebugMode(process)) {
        // ensure that if we start the node process in debug mode the server is also started in debug mode
        // could be useful to debug the sonar language server by attaching your debugger to port 8000
        params.push("-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000,quiet=y");
    }

    // always disable telemetry and data collection
    params.push("-Dsonarlint.telemetry.disabled=true");
    params.push("-Dsonarlint.monitoring.disabled=true");

    const sonarLintConfiguration = getSonarLintConfiguration();
    const vmargs = sonarLintConfiguration.get("ls.vmargs", "");

    parseVMargs(params, vmargs);
    if (sonarLintConfiguration.get("startFlightRecorder", false)) {
        params.push("-Dsonarlint.flightrecorder.enabled=true");
    }

    params.push("-jar", serverJar);
    params.push("-stdio");
    params.push("-analyzers");
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonargo.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonarjava.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonarjavasymbolicexecution.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonarjs.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonarphp.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonarpython.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonarhtml.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonarxml.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonartext.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonariac.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonarlintomnisharp.jar"));
    params.push(Path.resolve(context.extensionPath, "analyzers", "sonarcfamily.jar"));

    // TODO: this is probably not needed but kept for future reference to the implementation
    // it allows us to pull a dependency, on the fly for the analyzers instead of bundling
    // await maybeAddCFamilyJar(params);

    return { command: javaExecutablePath, args: params, transport: TransportKind.stdio };
}

export function parseVMargs(params: string[], vmargsLine: string) {
    if (!vmargsLine) {
        return;
    }
    const vmargs = vmargsLine.match(/(?:[^\s"]+|"[^"]*")+/g);
    if (vmargs === null) {
        return;
    }
    vmargs.forEach((arg) => {
        //remove all standalone double quotes
        arg = arg.replace(/(\\)?"/g, function ($0, $1) {
            return $1 ? $0 : "";
        });
        //unescape all escaped double quotes
        arg = arg.replace(/(\\)"/g, '"');
        if (params.indexOf(arg) < 0) {
            params.push(arg);
        }
    });
}
