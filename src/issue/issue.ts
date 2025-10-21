/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

"use strict";

import * as coc from "coc.nvim";
import { DateTime } from "luxon";
import { LocationTreeItem, revealTextRange, SecondaryLocationsTree } from "../location/locations";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import { ExtendedClient, ExtendedServer } from "../lsp/protocol";
import { adaptFlows, createDiagnosticFromIssue } from "../util/issue";
import { showNoActiveFileOpenWarning, showNoFileWithUriError } from "../util/showMessage";
import { code2ProtocolConverter, getRelativePathWithFileNameFromFullPath, pathExists, protocol2CodeConverter } from "../util/uri";
import { focusResourceLocation } from "../util/util";

export class IssueService {
    private static _instance: IssueService;

    static init(
        languageClient: SonarLintExtendedLanguageClient,
        secondaryLocationsTree: SecondaryLocationsTree,
        issueLocationsView: coc.TreeView<LocationTreeItem>
    ): void {
        IssueService._instance = new IssueService(languageClient, secondaryLocationsTree, issueLocationsView);
    }

    constructor(
        private readonly languageClient: SonarLintExtendedLanguageClient,
        private readonly secondaryLocationsTree: SecondaryLocationsTree,
        private readonly issueLocationsView: coc.TreeView<LocationTreeItem>
    ) {}

    static get instance(): IssueService {
        return IssueService._instance;
    }

    checkIssueStatusChangePermitted(folderUri: string, issueKey: string): Promise<ExtendedServer.CheckIssueStatusChangePermittedResponse> {
        return this.languageClient.checkIssueStatusChangePermitted(folderUri, issueKey);
    }

    async checkDependencyRiskStatusChangePermitted(issueKey: string): Promise<ExtendedServer.CheckIssueStatusChangePermittedResponse> {
        const allowedTransitions = await this.languageClient.getDependencyRiskTransitions(issueKey);
        return {
            permitted: allowedTransitions.transitions.length > 0,
            allowedStatuses: allowedTransitions.transitions,
            notPermittedReason: "You are not allowed to change the status of this dependency risk"
        };
    }

    changeIssueStatus(
        configScopeId: string,
        issueKey: string,
        newStatus: string,
        fileUri: string,
        comment: string,
        isTaintIssue: boolean
    ): Promise<void> {
        return this.languageClient.changeIssueStatus(configScopeId, issueKey, newStatus, fileUri, comment, isTaintIssue);
    }

    changeDependencyRiskStatus(configScopeId: string, dependencyRiskKey: string, transition: string, comment: string): Promise<void> {
        return this.languageClient.changeDependencyRiskStatus(configScopeId, dependencyRiskKey, transition, comment);
    }

    reopenLocalIssues() {
        const currentlyOpenFileUri = coc.window.activeTextEditor?.document.uri;
        if (currentlyOpenFileUri === undefined) {
            return;
        }
        const workspaceFolder = coc.workspace.getWorkspaceFolder(currentlyOpenFileUri);
        if (workspaceFolder === undefined) {
            return;
        }
        const fileRelativePath = getRelativePathWithFileNameFromFullPath(currentlyOpenFileUri, workspaceFolder);
        const unixStyleRelativePath = fileRelativePath.replace(/\\/g, "/");
        return this.languageClient.reopenResolvedLocalIssues(
            code2ProtocolConverter(coc.Uri.parse(workspaceFolder.uri)),
            unixStyleRelativePath,
            code2ProtocolConverter(coc.Uri.parse(currentlyOpenFileUri))
        );
    }

    analyseOpenFileIgnoringExcludes(triggeredByUser: boolean, textDocument?: coc.TextDocument) {
        const textEditor = coc.window.activeTextEditor;
        if (!textEditor) {
            // No active editor and no input provided either
            showNoActiveFileOpenWarning();
            return Promise.resolve();
        }
        if (textDocument) {
            const uri = textDocument?.uri;
            return this.languageClient.analyseOpenFileIgnoringExcludes(triggeredByUser, {
                uri: code2ProtocolConverter(coc.Uri.parse(uri)),
                languageId: textDocument.languageId,
                text: textDocument.getText(),
                version: textDocument.version
            });
        }

        return Promise.resolve();
    }

    static async showIssue(issue: ExtendedClient.Issue) {
        const documentUri = protocol2CodeConverter(issue.fileUri);
        const exists = await pathExists(documentUri);
        if (documentUri == null || !exists) {
            showNoFileWithUriError(documentUri);
        } else {
            await focusResourceLocation(documentUri);
            const diagnostic = createDiagnosticFromIssue(issue);
            issue.fileUri = code2ProtocolConverter(documentUri);

            if (issue.flows.length > 0) {
                issue.flows = await adaptFlows(issue);
                await IssueService.showAllLocations(issue);
            } else {
                await revealTextRange(coc.Range.create(diagnostic.range.start, diagnostic.range.end));
            }
        }
    }

    static async showAllLocations(issue: ExtendedClient.Issue) {
        await IssueService._instance.secondaryLocationsTree.showAllLocations(issue);
        if (issue.creationDate) {
            const createdAgo = issue.creationDate ? DateTime.fromISO(issue.creationDate).toLocaleString(DateTime.DATETIME_MED) : null;
            IssueService._instance.issueLocationsView.message = createdAgo
                ? `Analyzed ${createdAgo} on '${issue.connectionId}'`
                : `Detected by Sonarlint `;
        } else {
            IssueService._instance.issueLocationsView.message = undefined;
        }
        if (issue.flows.length > 0) {
            const children: coc.ProviderResult<LocationTreeItem[]> = IssueService._instance.secondaryLocationsTree.getChildren();
            if (children && children !== undefined) {
                IssueService._instance.issueLocationsView.reveal(children[0]);
            }
        }
    }
}
