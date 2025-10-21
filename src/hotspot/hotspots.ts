/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { FindingsTreeDataProvider, FindingsTreeViewItem } from "../findings/findingsTreeDataProvider";
import { HotspotNode, HotspotReviewPriority } from "../findings/findingTypes/hotspotNode";
import { revealTextRange } from "../location/locations";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import { AnalysisFile, ExtendedClient, ShowRuleDescriptionParams } from "../lsp/protocol";
import { Commands } from "../util/commands";
import { renderRuleHtmlWithCss } from "../util/htmlRenderer";
import { verboseLogToSonarLintOutput } from "../util/logging";
import {
    HotspotAnalysisConfirmation,
    notCompatibleServerWarning,
    noWorkspaceFolderToScanMessage,
    showChangeStatusConfirmationDialog,
    tooManyFilesConfirmation
} from "../util/showMessage";
import { code2ProtocolConverter, getUriFromRelativePath } from "../util/uri";
import {
    createAnalysisFilesFromFileUris,
    findFilesInFolder,
    focusResourceLocation,
    getFilesMatchedGlobPatterns,
    getFilesNotMatchedGlobPatterns,
    getIdeFileExclusions,
    getQuickPickListItemsForWorkspaceFolders
} from "../util/util";
import { showWebView } from "../util/webview";
import { computeHotspotContextPanelContent } from "./hotspotContextPanel";

export const HOTSPOTS_VIEW_ID = "SonarLint.SecurityHotspots";

export const OPEN_HOTSPOT_IN_IDE_SOURCE = "openInIde";

const FILE_COUNT_LIMIT_FOR_FULL_PROJECT_ANALYSIS = 1000;

export const showSecurityHotspot = async (
    allFindingsView: coc.TreeView<FindingsTreeViewItem>,
    findingsTreeDataProvider: FindingsTreeDataProvider,
    remoteHotspot?: ExtendedClient.RemoteHotspot
) => {
    const foundUris = await coc.workspace.findFiles(`**/${remoteHotspot?.ideFilePath}`);
    if (foundUris.length === 0) {
        handleFileForHotspotNotFound(remoteHotspot as ExtendedClient.RemoteHotspot);
    } else {
        const documentUri = foundUris[0];
        if (foundUris.length > 1) {
            verboseLogToSonarLintOutput(
                `Multiple candidates found for '${remoteHotspot?.ideFilePath}', using first match '${documentUri}'`
            );
        }
        const activeHotspot = remoteHotspot as ExtendedClient.RemoteHotspot;
        await revealInTreeView(activeHotspot, allFindingsView, findingsTreeDataProvider);
        await coc.commands.executeCommand(Commands.SHOW_HOTSPOT_DESCRIPTION, activeHotspot);
        await focusResourceLocation(documentUri);
        await highlightLocation(activeHotspot);
    }
};

function handleFileForHotspotNotFound(hotspot: ExtendedClient.RemoteHotspot) {
    coc.window
        .showErrorMessage(
            `Could not find file '${hotspot.ideFilePath}' in the current workspace.
Please make sure that the right folder is open and bound to the right project on the server,
 and that the file has not been removed or renamed.`,
            "Show Documentation"
        )
        .then((action) => {
            if (action === "Show Documentation") {
                coc.commands.executeCommand(
                    Commands.OPEN_BROWSER,
                    coc.Uri.parse("https://docs.sonarsource.com/sonarqube-server/user-guide/security-hotspots/")
                );
            }
        });
}

async function revealInTreeView(
    hotspot: ExtendedClient.RemoteHotspot,
    allFindingsView: coc.TreeView<FindingsTreeViewItem>,
    findingsTreeDataProvider: FindingsTreeDataProvider
) {
    const fileUri = getUriFromRelativePath(hotspot.ideFilePath, coc.workspace.workspaceFolders[0]);
    const rootFiles = await findingsTreeDataProvider.getRootFiles();
    const fileToHighlight = rootFiles.find((fileNode) => fileNode.fileUri === fileUri);
    allFindingsView.reveal(fileToHighlight as any, { select: true, focus: true, expand: true });
}

export function diagnosticSeverity(hotspot: ExtendedClient.RemoteHotspot) {
    switch (hotspot.rule.vulnerabilityProbability) {
        case ExtendedClient.HotspotProbability.high:
            return HotspotReviewPriority.High;
        case ExtendedClient.HotspotProbability.low:
            return HotspotReviewPriority.Low;
        default:
            return HotspotReviewPriority.Medium;
    }
}

export const showHotspotDescription = (factory: coc.FloatFactory) => {
    return async (activeHotspot: any) => {
        const text = computeHotspotContextPanelContent(
            activeHotspot.rule.securityCategory,
            activeHotspot.rule.vulnerabilityProbability,
            activeHotspot.author,
            activeHotspot.status,
            activeHotspot.message,
            activeHotspot.rule,
            false
        );
        const result = await renderRuleHtmlWithCss(text);
        await showWebView(factory, result.text, result.highlights);
    };
};

export const highlightLocation = async (activeHotspot: any) => {
    const startPosition = coc.Position.create(activeHotspot.textRange.startLine - 1, activeHotspot.textRange.startLineOffset);
    const endPosition = coc.Position.create(activeHotspot.textRange.endLine - 1, activeHotspot.textRange.endLineOffset);
    const visualRange = coc.Range.create(startPosition, endPosition);
    await revealTextRange(visualRange);
};

export async function getFilesForHotspotsAndLaunchScan(folderUri: coc.Uri, languageClient: SonarLintExtendedLanguageClient): Promise<void> {
    const response = await languageClient.getFilePatternsForAnalysis(folderUri.path);
    return coc.window.withProgress({ title: "Preparing Files to Scan...", cancellable: true }, async (progress, cancelToken) => {
        const checkLocalDetectionResponse = await languageClient.checkLocalHotspotsDetectionSupported(code2ProtocolConverter(folderUri));
        if (!checkLocalDetectionResponse.isSupported) {
            notCompatibleServerWarning(folderUri.path, checkLocalDetectionResponse.reason as string);
            return;
        }
        const files = await getFilesForHotspotsScan(folderUri, response.patterns, progress, cancelToken);
        if (cancelToken.isCancellationRequested) {
            return;
        }
        launchScanForHotspots(languageClient, folderUri, files);
        progress.report({ message: "Scanning files initiated", increment: 100 });
        coc.window.showInformationMessage(`Scanning initiated by Sonar for ${folderUri.fsPath}`);
    });
}

export async function useProvidedFolderOrPickManuallyAndScan(
    folderUri: coc.Uri,
    workspaceFolders: readonly coc.WorkspaceFolder[],
    languageClient: SonarLintExtendedLanguageClient,
    scan: (folderUri: coc.Uri, languageClient: SonarLintExtendedLanguageClient) => Promise<void>
) {
    if (!folderUri?.path) {
        if (!workspaceFolders || workspaceFolders.length === 0) {
            noWorkspaceFolderToScanMessage();
            return;
        }
        if (workspaceFolders.length === 1) {
            folderUri = coc.Uri.parse(workspaceFolders[0].uri);
            await scan(folderUri, languageClient);
        } else {
            const quickPickItems = getQuickPickListItemsForWorkspaceFolders(workspaceFolders);
            const workspaceFoldersQuickPick = await coc.window.showQuickPick(quickPickItems, {
                title: `Select Workspace Folder to scan for Hotspots`,
                placeholder: `Select Workspace Folder to scan for Hotspots`,
                canPickMany: false
            });

            if (workspaceFoldersQuickPick?.description !== undefined) {
                folderUri = coc.Uri.parse(workspaceFoldersQuickPick.description);
                await coc.window.showInformationMessage("Hot spot folder scanning starting");
                await scan(folderUri, languageClient);
            } else {
                coc.window.showWarningMessage("Hot spot folder scanning was canceled");
            }
        }
    } else {
        await scan(folderUri, languageClient);
    }
}

function launchScanForHotspots(
    languageClient: SonarLintExtendedLanguageClient,
    folderUri: coc.Uri,
    filesForHotspotsAnalysis: AnalysisFile[]
) {
    languageClient.scanFolderForHotspots({
        folderUri: code2ProtocolConverter(folderUri),
        documents: filesForHotspotsAnalysis
    });
}

export async function filesCountCheck(
    filesCount: number,
    confirmation: (filesCount: number) => Promise<string | undefined>
): Promise<boolean> {
    if (filesCount > FILE_COUNT_LIMIT_FOR_FULL_PROJECT_ANALYSIS) {
        const action = await confirmation(filesCount);
        if (action === HotspotAnalysisConfirmation.DONT_ANALYZE) {
            return false;
        }
    }
    return true;
}

export async function getFilesForHotspotsScan(
    folderUri: coc.Uri,
    globPatterns: string[],
    progress: coc.Progress<{
        message?: string;
        increment?: number;
    }>,
    cancelToken: coc.CancellationToken
): Promise<AnalysisFile[]> {
    const allFiles = await findFilesInFolder(folderUri, cancelToken);
    if (cancelToken.isCancellationRequested) {
        return [];
    }
    const filesWithKnownSuffixes = getFilesMatchedGlobPatterns(allFiles, globPatterns);
    if (cancelToken.isCancellationRequested) {
        return [];
    }
    const shouldAnalyze = await filesCountCheck(0, tooManyFilesConfirmation);
    if (!shouldAnalyze) {
        return [];
    }
    if (cancelToken.isCancellationRequested) {
        return [];
    }
    return await createAnalysisFilesFromFileUris(filesWithKnownSuffixes, coc.workspace.textDocuments, progress, cancelToken);
}

export function formatDetectedHotspotStatus(statusIndex: number) {
    return statusIndex === ExtendedClient.ExtendedHotspotStatus.ToReview
        ? "To review"
        : ExtendedClient.ExtendedHotspotStatus[statusIndex].toString();
}

export async function showHotspotDetails(hotspotDetails: ShowRuleDescriptionParams, hotspot: HotspotNode, factory: coc.FloatFactory) {
    const text = computeHotspotContextPanelContent(
        "",
        HotspotReviewPriority[hotspot.vulnerabilityProbability as number],
        "",
        formatDetectedHotspotStatus(hotspot.status as number),
        hotspot.message,
        hotspotDetails,
        true
    );
    const result = await renderRuleHtmlWithCss(text);
    await showWebView(factory, result.text, result.highlights);
}

export async function changeHotspotStatus(
    hotspotServerKey: string,
    fileUriAsSting: string,
    languageClient: SonarLintExtendedLanguageClient
) {
    const fileUri = coc.Uri.parse(fileUriAsSting);
    const workspaceFolder = coc.workspace.getWorkspaceFolder(fileUri);
    doChangeHotspotStatus(hotspotServerKey, fileUriAsSting, workspaceFolder as coc.WorkspaceFolder, languageClient);
}

export async function doChangeHotspotStatus(
    hotspotServerKey: string,
    fileUriAsSting: string,
    workspaceFolder: coc.WorkspaceFolder,
    languageClient: SonarLintExtendedLanguageClient
) {
    const allowedHotspotStatuses = await languageClient.getAllowedHotspotStatuses(
        hotspotServerKey,
        workspaceFolder.uri.toString(),
        fileUriAsSting
    );
    if (allowedHotspotStatuses == null) {
        return;
    }
    if (!allowedHotspotStatuses.permitted) {
        coc.window.showWarningMessage(`Not permitted to change hotspot status. Reason: ${allowedHotspotStatuses.notPermittedReason}`);
        return;
    }
    if (allowedHotspotStatuses.allowedStatuses.length === 0) {
        coc.window.showInformationMessage(`There are no allowed statuses to set for this hotspot`);
        return;
    }
    const statusQuickPickItems = allowedHotspotStatuses.allowedStatuses;
    const chosenStatus = await coc.window.showQuickPick(statusQuickPickItems, {
        title: "Change hotspot status",
        placeHolder: "Choose a status for the hotspot"
    });
    if (chosenStatus) {
        showChangeStatusConfirmationDialog("hotspot").then(async (answer) => {
            if (answer === "Yes") {
                languageClient.changeHotspotStatus(hotspotServerKey, chosenStatus, fileUriAsSting);
            }
        });
    }
}
