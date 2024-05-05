/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import * as child_process from 'child_process'
import * as coc from 'coc.nvim'
import { FileUris, ShouldAnalyseFileCheckResult } from '../lsp/protocol'

const ANALYSIS_EXCLUDES = 'sonarlint.analysisExcludesStandalone'

export function startedInDebugMode(process: NodeJS.Process): boolean {
    const args = process.execArgv
    if (args) {
        return args.some(arg => /^--debug=?/.test(arg) || /^--debug-brk=?/.test(arg) || /^--inspect-brk=?/.test(arg))
    }
    return false
}

export const extension = coc.extensions.getExtensionById('SonarSource.sonarlint-vscode')
export const packageJson = extension?.packageJSON
export const HOTSPOTS_FULL_SCAN_FILE_SIZE_LIMIT_BYTES = 500_000

export let extensionPath: string
export let extensionContext: coc.ExtensionContext

export function setExtensionContext(context: coc.ExtensionContext): void {
    extensionContext = context
    extensionPath = extensionContext.extensionPath
}

export function execChildProcess(process: string, workingDirectory: string, channel?: coc.OutputChannel) {
    return new Promise<string>((resolve, reject) => {
        child_process.exec(
            process,
            { cwd: workingDirectory, maxBuffer: 500 * 1024 },
            (error: Error | null, stdout: string, stderr: string) => {
                if (channel) {
                    let message = ''
                    let err = false
                    if (stdout && stdout.length > 0) {
                        message += stdout
                    }

                    if (stderr && stderr.length > 0) {
                        message += stderr
                        err = true
                    }

                    if (error) {
                        message += error.message
                        err = true
                    }

                    if (err) {
                        channel.append(message)
                        channel.show()
                    }
                }

                if (error) {
                    reject(error)
                    return
                }

                if (stderr && stderr.length > 0) {
                    reject(new Error(stderr))
                    return
                }

                resolve(stdout)
            }
        )
    })
}

export function globPatternToRegex(globPattern: string): RegExp {
    const commonSuffixGlobFormat = /^\*\*\/\*\.[a-z0-9]{1,6}$/
    if (commonSuffixGlobFormat.test(globPattern)) {
        const offsetForCommonGlobFormat = 5
        const suffix = globPattern.substring(offsetForCommonGlobFormat)
        const regexStr = `\\.${suffix}$`
        return new RegExp(regexStr)
    }
    const str = String(globPattern)
    let regex = ''
    const charsToEscape = new Set(['.', '+', '/', '|', '$', '^', '(', ')', '=', '!', ','])
    for (let i = 0; i < str.length; i++) {
        const c = str[i]
        if (charsToEscape.has(c)) {
            regex += '\\' + c
        } else if (c === '*') {
            const prev = str[i - 1]
            let asteriskCount = 1
            while (str[i + 1] === '*') {
                asteriskCount++
                i++
            }
            const next = str[i + 1]
            const dirMatcher = isDirMatcher(asteriskCount, prev, next)
            if (dirMatcher) {
                regex += '((?:[^/]*(?:/|$))*)'
                i++
            } else {
                regex += '([^/]*)'
            }
        } else if (c === '?') {
            regex += '.'
        } else {
            regex += c
        }
    }
    regex = `^${regex}$`
    return new RegExp(regex)
}

export function getFilesNotMatchedGlobPatterns(allFiles: coc.Uri[], globPatterns: string[]): coc.Uri[] {
    const masterRegex = getMasterRegex(globPatterns)
    return allFiles.filter(f => !masterRegex.test(f.path))
}

function isDirMatcher(asteriskCount: number, prev: string, next: string): boolean {
    return asteriskCount > 1 && (prev === '/' || prev === undefined) && (next === '/' || next === undefined)
}

export function getMasterRegex(globPatterns: string[]) {
    const regexes = globPatterns.map(p => globPatternToRegex(p).source)
    return new RegExp(regexes.join('|'), 'i')
}

export function shouldBeIgnored(_: string): boolean {
    return false
}

export function shouldAnalyseFile(fileUriStr: string): ShouldAnalyseFileCheckResult {
    const isOpen = isOpenInEditor(fileUriStr)
    if (!isOpen) {
        return { shouldBeAnalysed: false, reason: 'Skipping analysis for the file preview: ' }
    }
    const fileUri = coc.Uri.parse(fileUriStr)
    const workspaceFolderConfig = coc.workspace.getConfiguration()
    const excludes: string | undefined = workspaceFolderConfig.get(ANALYSIS_EXCLUDES)
    const excludesArray = excludes?.split(',').map(it => it.trim())
    const filteredFile = getFilesNotMatchedGlobPatterns([fileUri], excludesArray ?? [])
    return { shouldBeAnalysed: filteredFile.length === 1, reason: 'Skipping analysis for the excluded file: ' }
}

export function filterOutFilesIgnoredForAnalysis(fileUris: string[]): FileUris {
    const workspaceFolderConfig = coc.workspace.getConfiguration()
    const excludes: string | undefined = workspaceFolderConfig.get(ANALYSIS_EXCLUDES)
    const excludesArray = excludes?.split(',').map(it => it.trim())
    const filteredFiles = getFilesNotMatchedGlobPatterns(fileUris.map(it => coc.Uri.parse(it)), excludesArray ?? [])
        .map(it => it.toString())
    return { fileUris: filteredFiles }
}

function isOpenInEditor(fileUri: string) {
    const url = coc.Uri.parse(fileUri)
    const codeFileUri = url.toString()
    return coc.workspace.textDocuments.some(d => d.uri.toString() === codeFileUri)
}
