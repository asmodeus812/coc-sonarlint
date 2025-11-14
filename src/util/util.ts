/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as child_process from "child_process"
import * as coc from "coc.nvim"
import { Diagnostic, DiagnosticSeverity, Range } from "coc.nvim"
import * as FS from "fs"
import { ExecException } from "node:child_process"
import * as os from "node:os"
import * as path from "path"
import * as process from "process"
import { TextDecoder } from "util"
import { BindingService } from "../connected/binding"
import { AnalysisFile, ExtendedClient } from "../lsp/protocol"
import { SonarCloudRegion } from "../settings/connectionsettings"
import { verboseLogToSonarLintOutput } from "./logging"
import { RawAction } from "./types"
import { code2ProtocolConverter } from "./uri"

export const ANALYSIS_EXCLUDES = "sonarlint.analysisExcludesStandalone";
export const HOTSPOTS_FULL_SCAN_FILE_SIZE_LIMIT_BYTES = 500_000;

export function startedInDebugMode(process: NodeJS.Process): boolean {
    const args = process.execArgv;
    if (args) {
        return args.some((arg) => /^--debug=?/.test(arg) || /^--debug-brk=?/.test(arg) || /^--inspect-brk=?/.test(arg));
    }
    return false;
}

export function getExtensionVersionWithBuildNumber(): string {
    const { version, buildNumber } = getExtensionPackageJson();
    return buildNumber ? `${version}+${buildNumber}` : version;
}

export function getExtensionPackageJson(): any {
    const extension = coc.extensions.getExtensionById("coc-sonarlint");
    const packageJson = extension?.packageJSON;
    return packageJson;
}

export let extensionPath: string;
export let extensionContext: coc.ExtensionContext;

export function setExtensionContext(context: coc.ExtensionContext): void {
    extensionContext = context;
    extensionPath = extensionContext.extensionPath;
}

export function isRunningOnWindows() {
    return process.platform.startsWith("win32");
}

export function isRunningAutoBuild() {
    return process.env.NODE_ENV === "continuous-integration";
}

export function execChildProcess(process: string, workingDirectory: string, channel?: coc.OutputChannel) {
    return new Promise<string>((resolve, reject) => {
        child_process.exec(
            process,
            { cwd: workingDirectory, maxBuffer: 500 * 1024 },
            (error: ExecException | null, stdout: string, stderr: string) => {
                if (channel) {
                    let message = "";
                    let err = false;
                    if (stdout && stdout.length > 0) {
                        message += stdout;
                    }

                    if (stderr && stderr.length > 0) {
                        message += stderr;
                        err = true;
                    }

                    if (error) {
                        message += error.message;
                        err = true;
                    }

                    if (err) {
                        channel.append(message);
                        channel.show();
                    }
                }

                if (error) {
                    reject(error);
                    return;
                }

                if (stderr && stderr.length > 0) {
                    reject(new Error(stderr));
                    return;
                }

                resolve(stdout);
            }
        );
    });
}

export function resolveExtensionFile(...segments: string[]): coc.Uri {
    return coc.Uri.file(path.join(extensionPath, ...segments));
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatIssueMessage(message: string, ruleKey: string): coc.MarkupContent {
    return { value: `$(warning) ${message} \`sonarqube(${ruleKey})\`` } as coc.MarkupContent;
}

export async function findFilesInFolder(uri: coc.Uri, cancelToken: coc.CancellationToken): Promise<coc.Uri[]> {
    if (cancelToken.isCancellationRequested) {
        return [];
    }
    const filesInFolder = FS.readdirSync(uri.fsPath);
    let myFiles: string[] = [];
    for (const name of filesInFolder) {
        const fileUri = path.join(uri.fsPath, name);
        if (FS.statSync(fileUri).isDirectory()) {
            const childFiles = await findFilesInFolder(coc.Uri.parse(fileUri), cancelToken);
            myFiles = myFiles.concat(childFiles.map((c) => c.fsPath));
        } else if (FS.statSync(fileUri).isFile()) {
            myFiles.push(fileUri);
        }
    }
    return myFiles.map((f) => coc.Uri.parse(f));
}

export async function createAnalysisFilesFromFileUris(
    fileUris: coc.Uri[],
    openDocuments: readonly coc.TextDocument[],
    progress: coc.Progress<{
        message?: string;
        increment?: number;
    }>,
    cancelToken: coc.CancellationToken
): Promise<AnalysisFile[]> {
    if (cancelToken.isCancellationRequested) {
        return [];
    }
    const openedFileUrisToDocuments = new Map<string, coc.TextDocument>();
    openDocuments.forEach((d) => openedFileUrisToDocuments.set(d.uri, d));
    const filesRes: AnalysisFile[] = [];
    const totalFiles = fileUris.length;
    let currentFile = 0;
    for (const fileUri of fileUris) {
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        currentFile += 1;
        progress.report({ increment: (50.0 * currentFile) / totalFiles });
        const fileStat = FS.statSync(fileUri.fsPath);
        if (fileStat.size > HOTSPOTS_FULL_SCAN_FILE_SIZE_LIMIT_BYTES) {
            verboseLogToSonarLintOutput(`File will not be analysed because it's too large: ${fileUri.path}`);
            continue;
        }
        let fileContent: string;
        let version: coc.integer;
        const filePath = fileUri.path;
        if (openedFileUrisToDocuments.has(filePath)) {
            const openedDocument = openedFileUrisToDocuments.get(filePath);
            fileContent = openedDocument?.getText() as string;
            version = openedDocument?.version as coc.integer;
        } else {
            const contentArray = FS.readFileSync(fileUri.fsPath);
            fileContent = new TextDecoder().decode(contentArray);
            version = 1;
        }
        filesRes.push({
            uri: code2ProtocolConverter(fileUri),
            languageId: "[unknown]",
            version,
            text: fileContent
        });
    }
    return filesRes;
}

export function getQuickPickListItemsForWorkspaceFolders(workspaceFolders: readonly coc.WorkspaceFolder[]): coc.QuickPickItem[] {
    const quickPickItems: coc.QuickPickItem[] = [];
    for (const workspaceFolder of workspaceFolders) {
        quickPickItems.push({
            label: workspaceFolder.name,
            description: workspaceFolder.uri
        });
    }
    return quickPickItems;
}

export function globPatternToRegex(globPattern: string): RegExp {
    const commonSuffixGlobFormat = /^\*\*\/\*\.[a-z0-9]{1,6}$/;
    if (commonSuffixGlobFormat.test(globPattern)) {
        const offsetForCommonGlobFormat = 5;
        const suffix = globPattern.substring(offsetForCommonGlobFormat);
        const regexStr = `\\.${suffix}$`;
        return new RegExp(regexStr);
    }
    const str = String(globPattern);
    let regex = "";
    const charsToEscape = new Set([".", "+", "/", "|", "$", "^", "(", ")", "=", "!", ","]);
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (charsToEscape.has(c)) {
            regex += "\\" + c;
        } else if (c === "*") {
            const prev = str[i - 1];
            let asteriskCount = 1;
            while (str[i + 1] === "*") {
                asteriskCount++;
                i++;
            }
            const next = str[i + 1];
            const dirMatcher = isDirMatcher(asteriskCount, prev, next);
            if (dirMatcher) {
                regex += "((?:[^/]*(?:/|$))*)";
                i++;
            } else {
                regex += "([^/]*)";
            }
        } else if (c === "?") {
            regex += ".";
        } else {
            regex += c;
        }
    }
    regex = `^${regex}$`;
    return new RegExp(regex);
}

export function getFilesMatchedGlobPatterns(allFiles: coc.Uri[], globPatterns: string[]): coc.Uri[] {
    const masterRegex = getMasterRegex(globPatterns);
    return allFiles.filter((f) => masterRegex.test(f.path));
}

export function getFilesNotMatchedGlobPatterns(allFiles: coc.Uri[], globPatterns: string[]): coc.Uri[] {
    const masterRegex = getMasterRegex(globPatterns);
    return allFiles.filter((f) => !masterRegex.test(f.path));
}

function isDirMatcher(asteriskCount: number, prev: string, next: string): boolean {
    return asteriskCount > 1 && (prev === "/" || prev === undefined) && (next === "/" || next === undefined);
}

export function getMasterRegex(globPatterns: string[]) {
    const regexes = globPatterns.map((p) => globPatternToRegex(p).source);
    return new RegExp(regexes.join("|"), "i");
}

export function getIdeFileExclusions(excludes): string[] {
    const excludedPatterns: string[] = [];
    for (const pattern in excludes) {
        const isExcluded = excludes[pattern];
        if (isExcluded) {
            excludedPatterns.push(pattern);
        }
    }
    return excludedPatterns;
}

export function shouldAnalyseFile(fileUriStr: string): ExtendedClient.ShouldAnalyseFileCheckResult {
    const isOpen = isOpenInEditor(fileUriStr);
    if (!isOpen) {
        return { shouldBeAnalysed: false, reason: `Skipping analysis for ${fileUriStr}` };
    }
    const fileUri = coc.Uri.parse(fileUriStr);
    const workspaceFolder = coc.workspace.getWorkspaceFolder(fileUri);
    let scope: string | undefined;
    if (workspaceFolder !== undefined) {
        scope = workspaceFolder.uri;
        const isBound = BindingService.instance.isBound(workspaceFolder);
        if (isBound) {
            return { shouldBeAnalysed: true };
        }
    }
    const workspaceFolderConfig = coc.workspace.getConfiguration(undefined, scope);
    const excludes: string | undefined = workspaceFolderConfig.get(ANALYSIS_EXCLUDES);
    const excludesArray = excludes?.split(",").map((it) => it.trim());
    const filteredFile = getFilesNotMatchedGlobPatterns([fileUri], excludesArray || []);
    return { shouldBeAnalysed: filteredFile.length === 1, reason: `Skipping excluded ${filteredFile.length > 0 ? fileUri : "none"}` };
}

export function filterOutFilesIgnoredForAnalysis(fileUris: string[]): ExtendedClient.FileUris {
    // assuming non-empty and all files from the same workspace
    const workspaceFolder = coc.workspace.getWorkspaceFolder(coc.Uri.parse(fileUris[0]));
    let scope: string | undefined;
    if (workspaceFolder !== undefined) {
        scope = workspaceFolder.uri;
    }
    const workspaceFolderConfig = coc.workspace.getConfiguration(undefined, scope);
    const excludes: string | undefined = workspaceFolderConfig.get(ANALYSIS_EXCLUDES);
    const excludesArray = excludes?.split(",").map((it) => it.trim());
    const filteredFiles = getFilesNotMatchedGlobPatterns(
        fileUris.map((it) => coc.Uri.parse(it)),
        excludesArray || []
    ).map((it) => it.toString());
    return { fileUris: filteredFiles };
}

export function isOpenInEditor(fileUri: string) {
    const url = coc.Uri.parse(fileUri);
    const codeFileUri = url.toString();
    return coc.workspace.textDocuments.some((d) => d.uri.toString() === codeFileUri);
}

export function getSeverity(severity: number): coc.DiagnosticSeverity {
    const SEVERITY_ERROR = 1;
    const SEVERITY_WARNING = 2;
    const SEVERITY_INFORMATION = 3;
    const SEVERITY_HINT = 4;
    switch (severity) {
        case SEVERITY_ERROR:
            return coc.DiagnosticSeverity.Error;
        case SEVERITY_WARNING:
            return coc.DiagnosticSeverity.Warning;
        case SEVERITY_INFORMATION:
            return coc.DiagnosticSeverity.Information;
        case SEVERITY_HINT:
            return coc.DiagnosticSeverity.Hint;
        default:
            return coc.DiagnosticSeverity.Warning;
    }
}

export function mapVscodeSeverityToLspSeverity(severity: coc.DiagnosticSeverity): DiagnosticSeverity {
    switch (severity) {
        case coc.DiagnosticSeverity.Error:
            return DiagnosticSeverity.Error;
        case coc.DiagnosticSeverity.Warning:
            return DiagnosticSeverity.Warning;
        case coc.DiagnosticSeverity.Information:
            return DiagnosticSeverity.Information;
        case coc.DiagnosticSeverity.Hint:
            return DiagnosticSeverity.Hint;
        default:
            return DiagnosticSeverity.Warning;
    }
}

export function sonarCloudRegionToLabel(region: number): SonarCloudRegion {
    switch (region) {
        case 0:
            return "EU";
        case 1:
            return "US";
        default:
            return "EU";
    }
}

export function sanitizeSonarCloudRegionSetting(region: string | undefined): SonarCloudRegion {
    if (!region) {
        return "EU";
    }
    // Technically, users could put anything in the `region` setting. If it is something invalid, we default to EU.
    switch (region.toUpperCase()) {
        case "EU":
            return "EU";
        case "US":
            return "US";
        default:
            return "EU";
    }
}

export function convertVscodeDiagnosticToLspDiagnostic(diagnostic: coc.Diagnostic): Diagnostic {
    // Convert range
    const range: Range = {
        start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
        end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character }
    };

    const lspDiag = {
        range,
        message: diagnostic.message,
        severity: mapVscodeSeverityToLspSeverity(diagnostic.severity as DiagnosticSeverity),
        code: diagnostic.code as string,
        source: diagnostic.source,
        data: diagnostic["data"]
    };

    return lspDiag;
}

export function getVSCodeSettingsBaseDir(): string {
    const currentPlatform = os.platform();
    switch (currentPlatform) {
        case "win32":
            return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        case "darwin":
            return path.join(os.homedir(), "Library", "Application Support");
        default:
            // linux and others
            return path.join(os.homedir(), ".config");
    }
}

export async function focusResourceLocation(location: coc.Uri | string, destWindow?: number, openCommand?: string): Promise<void> {
    const stringUri: string = typeof location === "string" ? location : location.toString();
    const textEditor: coc.TextEditor | undefined = coc.window.activeTextEditor;
    if (textEditor?.document.uri !== stringUri) {
        let visibleEditor: coc.TextEditor | undefined = undefined;
        for (const editor of coc.window.visibleTextEditors) {
            if (stringUri === editor?.document.uri) {
                visibleEditor = editor;
                break;
            }
        }
        if (visibleEditor?.winid) {
            await coc.workspace.nvim.call("win_gotoid", [visibleEditor.winid]);
            return;
        }
    }

    if (destWindow !== undefined) {
        await coc.workspace.nvim.call("win_gotoid", [destWindow]);
    } else {
        const filetype = await coc.workspace.nvim.eval("&filetype");
        const buftype = await coc.workspace.nvim.eval("&buftype");
        if (buftype !== "" || filetype === "cocedits" || filetype === "coctree") {
            const winid = await coc.workspace.nvim.exec("echo winnr('#')", true);
            await coc.workspace.nvim.call("win_gotoid", [winid]);
        }
    }
    await coc.workspace.jumpTo(location, null, openCommand);
}

export async function hideTargetView(view: coc.TreeView<any>) {
    try {
        // we can ignore this, since it is not exported from coc
        await view.hide();
        return true;
    } catch (error) {
        void coc.window.showWarningMessage(`Failed to close the view ${(error as Error).message}`);
        return false;
    }
}

export async function showTargetView(view: coc.TreeView<any>, title?: string) {
    if (title && title !== undefined) {
        view.title = title;
    }
    if (view?.visible) {
        const winId = view.windowId;
        const nvim: any = coc.workspace.nvim;
        const tabnr = (await nvim.call("tabpagenr")) as number;
        const buflist = (await nvim.call("tabpagebuflist", [tabnr])) as number[];
        const bufId = await nvim.call("winbufnr", [winId]);
        const found = buflist.find((bufnr) => {
            return bufId == bufnr;
        });
        if (!found) {
            await nvim.call("coc#window#close", [winId]);
            await view?.show("botright 10split");
        }
    } else if (!view?.visible) {
        await view?.show("botright 10split");
    }
}

export function actionsForContext(actions: RawAction[], contextValue?: string): RawAction[] {
    return actions.filter((a) => a.contextValues.includes("*") || (contextValue ? a.contextValues.includes(contextValue) : false));
}

export async function showActionQuickPick(actions: RawAction[], payload: any): Promise<void> {
    const allowed = actionsForContext(actions, payload.contextValue);

    if (allowed.length === 0) {
        void coc.window.showWarningMessage(`No actions for context "${payload.contextValue ?? "unknown"}".`);
        return;
    }

    const pickItems = allowed.map((action) => ({
        description: action.detail ? `(${action.detail})` : undefined,
        label: action.title,
        action: action
    }));

    const picked = await coc.window.showQuickPick(pickItems, {
        placeHolder: "Select action to execute",
        matchOnDescription: true,
        canPickMany: false
    });

    if (!picked || picked === undefined) {
        return;
    }

    const args = picked.action.arguments ? picked.action.arguments(payload) : [payload];
    await coc.commands.executeCommand(picked.action.command, ...args);
}
