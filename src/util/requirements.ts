/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// Highly inspired from https://github.com/redhat-developer/vscode-java/blob/1f6783957c699e261a33d05702f2da356017458d/src/requirements.ts
"use strict";

import * as cp from "child_process";
import * as coc from "coc.nvim";
import expandHomeDir from "expand-home-dir";
import findJavaHome from "find-java-home";
import * as fs from "fs";
import * as path from "path";
import * as jre from "../java/jre";
import { Commands } from "./commands";
import { logToSonarLintOutput } from "./logging";
import { PlatformInformation } from "./platform";
import * as util from "./util";

const REQUIRED_JAVA_VERSION = 17;

const isWindows = process.platform.startsWith("win");
const JAVA_FILENAME = `java${isWindows ? ".exe" : ""}`;
export const JAVA_HOME_CONFIG = "sonarlint.ls.javaHome";

export interface RequirementsData {
    javaHome: string;
    javaVersion: number;
}

export async function resolveRequirements(context: coc.ExtensionContext): Promise<RequirementsData> {
    let javaHome = readJavaConfig();
    let tryResolveJre = false;
    if (javaHome) {
        const source = `'${JAVA_HOME_CONFIG}' variable defined in VS Code settings`;
        javaHome = expandHomeDir(javaHome);
        if (!fs.existsSync(javaHome as string)) {
            logToSonarLintOutput(`The ${source} points to a missing or inaccessible folder (${javaHome})`);
        } else if (!fs.existsSync(path.resolve(javaHome as string, "bin", JAVA_FILENAME))) {
            let msg: string;
            if (fs.existsSync(path.resolve(javaHome as string, JAVA_FILENAME))) {
                msg = `'bin' should be removed from the ${source} (${javaHome})`;
            } else {
                msg = `The ${source} (${javaHome}) does not point to a JRE. Will try to use embedded JRE.`;
            }
            logToSonarLintOutput(msg);
            tryResolveJre = true;
        }
    }
    if (!javaHome || tryResolveJre) {
        const jreDir = path.join(context.extensionPath, "jre");
        if (fs.existsSync(jreDir) && fs.statSync(jreDir).isDirectory()) {
            const dirs = fs.readdirSync(jreDir);
            const javaDir = dirs[0];
            javaHome = path.join(jreDir, javaDir);
        } else {
            javaHome = await checkJavaRuntime();
        }
    }
    const javaVersion = await checkJavaVersion(javaHome);
    return { javaHome, javaVersion };
}

function checkJavaRuntime(): Promise<string> {
    return new Promise((resolve, reject) => {
        let { source, javaHome } = tryExplicitConfiguration();
        if (javaHome) {
            javaHome = expandHomeDir(javaHome);
            if (!fs.existsSync(javaHome as string)) {
                invalidJavaHome(reject, `The ${source} points to a missing or inaccessible folder (${javaHome})`);
            } else if (!fs.existsSync(path.resolve(javaHome as string, "bin", JAVA_FILENAME))) {
                let msg: string;
                if (fs.existsSync(path.resolve(javaHome as string, JAVA_FILENAME))) {
                    msg = `'bin' should be removed from the ${source} (${javaHome})`;
                } else {
                    msg = `The ${source} (${javaHome}) does not point to a JRE.`;
                }
                invalidJavaHome(reject, msg);
            }
            resolve(javaHome as string);
        }

        // No settings let's try to detect
        findJavaHome((err, home) => {
            if (err || !home) {
                // No Java detected, last resort is to ask for permission to download and manage our own
                suggestManagedJre(reject);
            } else {
                resolve(home);
            }
        });
    });
}

function tryExplicitConfiguration() {
    let source: string;
    let javaHome: string | undefined = readJavaConfig();
    if (javaHome) {
        source = `'${JAVA_HOME_CONFIG}' variable defined in VS Code settings`;
    } else {
        javaHome = process.env["JDK_HOME"];
        if (javaHome) {
            source = "JDK_HOME environment variable";
        } else {
            javaHome = process.env["JAVA_HOME"];
            source = "JAVA_HOME environment variable";
        }
    }
    return { source, javaHome: javaHome ? javaHome.trim() : null };
}

function readJavaConfig(): string | undefined {
    return coc.workspace.getConfiguration().get<string>(JAVA_HOME_CONFIG);
}

function checkJavaVersion(javaHome: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const javaExec = path.join(javaHome, "bin", "java");
        cp.execFile(javaExec, ["-version"], {}, (error, stdout, stderr) => {
            const javaVersion = parseMajorVersion(stderr);
            if (javaVersion < REQUIRED_JAVA_VERSION) {
                openJREDownload(
                    reject,
                    `Java ${REQUIRED_JAVA_VERSION} or more recent is required to run.
Please download and install a recent JRE.`
                );
            } else {
                resolve(javaVersion);
            }
        });
    });
}

export function parseMajorVersion(content: string): number {
    let regexp = /version "(.*)"/g;
    let match = regexp.exec(content);
    if (!match) {
        return 0;
    }
    let version = match[1];
    //Ignore "1." prefix for legacy Java versions
    const legacyPrefix = "1.";
    if (version.startsWith(legacyPrefix)) {
        version = version.substring(legacyPrefix.length);
    }
    //look into the interesting bits now
    regexp = /\d+/g;
    match = regexp.exec(version);
    let javaVersion = 0;
    if (match) {
        javaVersion = Number.parseInt(match[0]);
    }
    return javaVersion;
}

function suggestManagedJre(reject) {
    reject({
        message: `The Java Runtime Environment can not be located. Please install a JRE, or configure its path with the
      ${JAVA_HOME_CONFIG} property. You can also let Sonarlint download the JRE from AdoptOpenJDK. This JRE will be
      used only by Sonarlint .`,
        label: "Let Sonarlint download the JRE",
        command: Commands.INSTALL_MANAGED_JRE
    });
}

function openJREDownload(reject, cause) {
    const jreUrl = "https://www.oracle.com/technetwork/java/javase/downloads/index.html";
    reject({
        message: cause,
        label: "Get the Java Runtime Environment",
        command: Commands.OPEN_BROWSER,
        commandParam: coc.Uri.parse(jreUrl)
    });
}

function invalidJavaHome(reject, cause: string) {
    if (cause.indexOf(JAVA_HOME_CONFIG) > -1) {
        reject({
            message: cause,
            label: "Open settings",
            command: Commands.OPEN_SETTINGS,
            commandParam: JAVA_HOME_CONFIG
        });
    } else {
        reject({
            message: cause
        });
    }
}

export async function findEmbeddedJRE(context: coc.ExtensionContext): Promise<string | undefined> {
    const jreHome = context.asAbsolutePath("jre");
    if (fs.existsSync(jreHome) && fs.statSync(jreHome).isDirectory()) {
        const candidates = fs.readdirSync(jreHome);
        for (const candidate of candidates) {
            if (fs.existsSync(path.join(jreHome, candidate, "bin", JAVA_FILENAME))) {
                return path.join(jreHome, candidate);
            }
        }
    }
    return Promise.resolve(undefined);
}

export function installManagedJre() {
    return coc.window.withProgress({ title: "Sonarlint JRE Install..." }, async (progress, _) => {
        try {
            const platformInfo = await PlatformInformation.GetPlatformInformation();
            const options = {
                os: platformInfo.os as jre.Os,
                architecture: platformInfo.arch as jre.Architecture,
                version: REQUIRED_JAVA_VERSION as jre.Version
            };
            progress.report({ message: "Downloading..." });
            const downloadResponse = await jre.download(options, path.join(util.extensionPath, "..", "sonarsource.sonarlint_managed-jre"));
            progress.report({ message: "Uncompressing..." });
            const jreInstallDir = await jre.unzip(downloadResponse);
            progress.report({ message: "Finished" });
            coc.workspace.getConfiguration("sonarlint.ls").update("javaHome", jreInstallDir, coc.ConfigurationTarget.Global);
        } catch (err) {
            logToSonarLintOutput(err);
        }
    });
}
