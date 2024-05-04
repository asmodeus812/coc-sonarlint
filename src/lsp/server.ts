/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as Path from "path";
import * as coc from "coc.nvim";
import { getSonarLintConfiguration } from "../settings/settings";
import { RequirementsData } from "../util/requirements";
import * as util from "../util/util";

declare let v8debug: object;
const DEBUG = typeof v8debug === "object" || util.startedInDebugMode(process);

export function languageServerCommand(
    context: coc.ExtensionContext,
    requirements: RequirementsData,
) {
    const location = getSonarLintConfiguration().get("ls.directory", context.extensionPath)
    const serverJar = Path.resolve(
        location,
        "server",
        "sonarlint-ls.jar",
    );
    const javaExecutablePath = Path.resolve(requirements.javaHome, "bin", "java");

    const params: string[] = [];
    if (DEBUG) {
        params.push(
            "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000,quiet=y",
        );
        params.push("-Dsonarlint.telemetry.disabled=true");
    }
    const vmargs = getSonarLintConfiguration().get("ls.vmargs", "");
    parseVMargs(params, vmargs);
    params.push("-jar", serverJar);
    params.push("-stdio");
    params.push("-analyzers");
    params.push(Path.resolve(location, "analyzers", "sonargo.jar"));
    params.push(
        Path.resolve(location, "analyzers", "sonarjava.jar"),
    );
    params.push(Path.resolve(location, "analyzers", "sonarjs.jar"));
    params.push(Path.resolve(location, "analyzers", "sonarphp.jar"));
    params.push(
        Path.resolve(location, "analyzers", "sonarpython.jar"),
    );
    params.push(
        Path.resolve(location, "analyzers", "sonarhtml.jar"),
    );
    params.push(Path.resolve(location, "analyzers", "sonarxml.jar"));
    params.push(
        Path.resolve(location, "analyzers", "sonarcfamily.jar"),
    );
    params.push(
        Path.resolve(location, "analyzers", "sonartext.jar"),
    );
    params.push(Path.resolve(location, "analyzers", "sonariac.jar"));
    params.push(
        Path.resolve(location, "analyzers", "sonarlintomnisharp.jar"),
    );

    return {
        command: javaExecutablePath,
        args: params,
        transport: coc.TransportKind.stdio,
    };
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
