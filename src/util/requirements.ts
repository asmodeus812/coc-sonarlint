/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict"

import * as cp from "child_process"
import expandHomeDir from "expand-home-dir"
import findJavaHome from "find-java-home"
import * as fse from "fs-extra"
import * as path from "path"
import * as jre from '../java/jre'
import pathExists from "path-exists"
import * as coc from "coc.nvim"
import { Commands } from "./commands"
import { logToSonarLintOutput } from "./logging"
import { PlatformInformation } from 'coc-sonarlint/src/util/platform'
import { checkAndDownloadJRE } from '../java/jre'

const REQUIRED_JAVA_VERSION = 17

const isWindows = process.platform.startsWith("win")
const JAVA_FILENAME = `java${isWindows ? ".exe" : ""}`
export const JAVA_HOME_CONFIG = "sonarlint.ls.javaHome"

export interface RequirementsData {
    javaHome: string
    javaVersion: number
}

export async function resolveRequirements(
    context: coc.ExtensionContext,
): Promise<RequirementsData> {
    let javaHome = readJavaConfig()
    let tryResolveJre = false
    if (javaHome) {
        const source = `'${JAVA_HOME_CONFIG}' variable defined in VS Code settings`
        javaHome = expandHomeDir(javaHome)
        if (!pathExists.sync(javaHome)) {
            logToSonarLintOutput(
                `The ${source} points to a missing or inaccessible folder (${javaHome})`,
            )
        } else if (!pathExists.sync(path.resolve(javaHome, "bin", JAVA_FILENAME))) {
            let msg: string
            if (pathExists.sync(path.resolve(javaHome, JAVA_FILENAME))) {
                msg = `'bin' should be removed from the ${source} (${javaHome})`
            } else {
                msg = `The ${source} (${javaHome}) does not point to a JRE`
            }
            logToSonarLintOutput(msg)
            tryResolveJre = true
        }
    }
    if (!javaHome || tryResolveJre) {
        const jreDir = path.join(__dirname, "../jre")
        if (fse.existsSync(jreDir) && fse.statSync(jreDir).isDirectory()) {
            const dirs = fse.readdirSync(jreDir)
            const javaDir = dirs[0]
            javaHome = path.join(jreDir, javaDir)
        } else {
            javaHome = await checkJavaRuntime(context)
        }
    }
    const javaVersion = await checkJavaVersion(javaHome)
    return { javaHome, javaVersion }
}

function checkJavaRuntime(context: coc.ExtensionContext): Promise<string> {
    return new Promise((resolve, reject) => {
        let { source, javaHome } = tryExplicitConfiguration()
        if (javaHome) {
            javaHome = expandHomeDir(javaHome)
            if (!pathExists.sync(javaHome)) {
                invalidJavaHome(
                    reject,
                    `The ${source} points to a missing or inaccessible folder (${javaHome})`,
                )
            } else if (
                !pathExists.sync(path.resolve(javaHome, "bin", JAVA_FILENAME))
            ) {
                let msg: string
                if (pathExists.sync(path.resolve(javaHome, JAVA_FILENAME))) {
                    msg = `'bin' should be removed from the ${source} (${javaHome})`
                } else {
                    msg = `The ${source} (${javaHome}) does not point to a JRE.`
                }
                invalidJavaHome(reject, msg)
            }
            resolve(javaHome)
        }

        findJavaHome((err, home) => {
            if (err || !home) {
                installManagedJre(context, resolve, reject)
            } else {
                resolve(home)
            }
        })
    })
}

function tryExplicitConfiguration(): { source: string; javaHome: string } {
    let source: string = "java defined on path"
    let javaHome: string = readJavaConfig()
    if (javaHome) {
        source = `'${JAVA_HOME_CONFIG}' variable defined in settings`
    } else {
        let jdkHomeEnv: string | undefined = process.env["JDK_HOME"]
        let javaHomeEnv: string | undefined = process.env["JAVA_HOME"]
        if (jdkHomeEnv) {
            source = "JDK_HOME environment variable"
            javaHome = jdkHomeEnv
        } else if (javaHomeEnv) {
            javaHome = javaHomeEnv
            source = "JAVA_HOME environment variable"
        }
    }
    return { source, javaHome }
}

function readJavaConfig(): string {
    return coc.workspace.getConfiguration().get<string>(JAVA_HOME_CONFIG, "java")
}

function checkJavaVersion(javaHome: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const javaExec = path.join(javaHome, "bin", "java")
        cp.execFile(javaExec, ["-version"], {}, (_, __, stderr) => {
            const javaVersion = parseMajorVersion(stderr)
            if (javaVersion < REQUIRED_JAVA_VERSION) {
                openJREDownload(
                    reject,
                    `Java ${REQUIRED_JAVA_VERSION} or more recent is required to run.
                                            Please download and install a recent JRE.`,
                )
            } else {
                resolve(javaVersion)
            }
        })
    })
}

export function parseMajorVersion(content: string): number {
    let regexp = /version "(.*)"/g
    let match = regexp.exec(content)
    if (!match) {
        return 0
    }
    let version = match[1]
    //Ignore "1." prefix for legacy Java versions
    const legacyPrefix = "1."
    if (version.startsWith(legacyPrefix)) {
        version = version.substring(legacyPrefix.length)
    }
    //look into the interesting bits now
    regexp = /\d+/g
    match = regexp.exec(version)
    let javaVersion = 0
    if (match) {
        javaVersion = parseInt(match[0])
    }
    return javaVersion
}

function openJREDownload(reject: any, cause: string) {
    const jreUrl =
        "https://www.oracle.com/technetwork/java/javase/downloads/index.html"
    reject({
        message: cause,
        label: "Get the Java Runtime Environment",
        command: Commands.OPEN_BROWSER,
        commandParam: coc.Uri.parse(jreUrl),
    })
}

function invalidJavaHome(reject: any, cause: string) {
    if (cause.indexOf(JAVA_HOME_CONFIG) > -1) {
        reject({
            message: cause,
            label: "Open settings",
            command: Commands.OPEN_SETTINGS,
            commandParam: JAVA_HOME_CONFIG,
        })
    } else {
        reject({
            message: cause,
        })
    }
}

export function installManagedJre(context: coc.ExtensionContext, resolve: any, reject: any) {
    return checkAndDownloadJRE(context)
        .then(jreInstallDir => {
            coc.workspace
                .getConfiguration('sonarlint.ls')
                .update('javaHome', jreInstallDir, coc.ConfigurationTarget.Global)
            resolve(jreInstallDir)
        })
        .catch(err => reject(err))
}
