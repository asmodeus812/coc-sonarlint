/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import * as coc from "coc.nvim"
import { ServerMode } from "../java/java"
import { code2ProtocolConverter } from "../util/uri"
import * as protocol from "./protocol"
import { AnalysisFile } from "./protocol"

export class SonarLintExtendedLanguageClient extends coc.LanguageClient {

    listAllRules(): Thenable<protocol.RulesResponse> {
        return this.sendRequest(protocol.ListAllRulesRequest.type)
    }

    didClasspathUpdate(projectRoot: coc.Uri): void {
        const projectUri = code2ProtocolConverter(projectRoot)
        this.sendNotification(protocol.DidClasspathUpdateNotification.type, {
            projectUri,
        })
    }

    didJavaServerModeChange(serverMode: ServerMode) {
        this.sendNotification(protocol.DidJavaServerModeChangeNotification.type, {
            serverMode,
        })
    }

    didLocalBranchNameChange(folderRoot: coc.Uri, branchName?: string) {
        const folderUri = code2ProtocolConverter(folderRoot)
        this.sendNotification(protocol.DidLocalBranchNameChangeNotification.type, {
            folderUri,
            branchName,
        })
    }

    checkConnection(connectionId: string) {
        return this.sendRequest(protocol.CheckConnection.type, { connectionId })
    }

    checkNewConnection(
        token: string,
        serverOrOrganization: string,
        isSonarQube: boolean,
    ) {
        const params = isSonarQube
            ? { token, serverUrl: serverOrOrganization }
            : { token, organization: serverOrOrganization }
        return this.sendRequest(protocol.CheckConnection.type, params)
    }

    getRemoteProjectNames(connectionId: string, projectKeys: Array<string>) {
        return this.sendRequest(protocol.GetRemoteProjectNames.type, {
            connectionId,
            projectKeys,
        })
    }

    onTokenUpdate(connectionId: string, token: string) {
        return this.sendNotification(protocol.OnTokenUpdate.type, {
            connectionId,
            token,
        })
    }

    getRemoteProjectsForConnection(connectionId: string) {
        return this.sendRequest(protocol.GetRemoteProjectsForConnection.type, {
            connectionId,
        })
    }

    generateToken(
        baseServerUrl: string,
    ): Promise<protocol.GenerateTokenResponse> {
        return this.sendRequest(protocol.GenerateToken.type, { baseServerUrl })
    }

    showHotspotLocations(hotspotKey: string, fileUri: string): void {
        this.sendRequest(protocol.ShowHotspotLocations.type, {
            hotspotKey,
            fileUri,
        })
    }

    showHotspotRuleDescription(
        ruleKey: string,
        hotspotId: string,
        fileUri: string,
    ) {
        this.sendNotification(
            protocol.ShowHotspotRuleDescriptionNotification.type,
            { ruleKey, hotspotId, fileUri },
        )
    }

    openHotspotOnServer(hotspotId: string, fileUri: string) {
        this.sendNotification(protocol.OpenHotspotOnServer.type, {
            hotspotId,
            fileUri,
        })
    }

    helpAndFeedbackLinkClicked(itemId: string) {
        this.sendNotification(protocol.HelpAndFeedbackLinkClicked.type, {
            id: itemId,
        })
    }

    scanFolderForHotspots(params: protocol.ScanFolderForHotspotsParams) {
        this.sendNotification(protocol.ScanFolderForHotspots.type, params)
    }

    forgetFolderHotspots() {
        this.sendNotification(protocol.ForgetFolderHotspots.type)
    }

    getFilePatternsForAnalysis(
        folderUri: string,
    ): Promise<protocol.GetFilePatternsForAnalysisResponse> {
        return this.sendRequest(protocol.GetFilePatternsForAnalysis.type, {
            uri: folderUri,
        })
    }

    getAllowedHotspotStatuses(
        hotspotKey: string,
        folderUri: string,
        fileUri: string,
    ): Promise<protocol.GetAllowedHotspotStatusesResponse> {
        return this.sendRequest(protocol.GetAllowedHotspotStatuses.type, {
            hotspotKey,
            folderUri,
            fileUri,
        })
    }

    getSuggestedBinding(
        configScopeId: string,
        connectionId: string,
    ): Promise<protocol.GetSuggestedBindingResponse> {
        return this.sendRequest(protocol.GetSuggestedBinding.type, {
            configScopeId,
            connectionId,
        })
    }

    getSharedConnectedModeConfigFileContent(
        configScopeId: string,
    ): Promise<protocol.GetSharedConnectedModeConfigFileResponse> {
        return this.sendRequest(
            protocol.GetSharedConnectedModeConfigFileContents.type,
            { configScopeId },
        )
    }

    checkIssueStatusChangePermitted(
        folderUri: string,
        issueKey: string,
    ): Promise<protocol.CheckIssueStatusChangePermittedResponse> {
        return this.sendRequest(protocol.CheckIssueStatusChangePermitted.type, {
            folderUri,
            issueKey,
        })
    }

    changeIssueStatus(
        configurationScopeId: string,
        issueId: string,
        newStatus: string,
        fileUri: string,
        comment: string,
        isTaintIssue: boolean,
    ): Promise<void> {
        return this.sendNotification(protocol.SetIssueStatus.type, {
            configurationScopeId,
            issueId,
            newStatus,
            fileUri,
            comment,
            isTaintIssue,
        })
    }

    reopenResolvedLocalIssues(
        configurationScopeId: string,
        relativePath: string,
        fileUri: string,
    ): Promise<void> {
        return this.sendNotification(protocol.ReopenResolvedLocalIssues.type, {
            configurationScopeId,
            relativePath,
            fileUri,
        })
    }

    analyseOpenFileIgnoringExcludes(
        textDocument?: AnalysisFile,
        notebookDocument?: coc.TextDocument,
        notebookCells?: AnalysisFile[],
    ): Promise<void> {
        return this.sendNotification(
            protocol.AnalyseOpenFileIgnoringExcludes.type,
            {
                textDocument,
                notebookUri: notebookDocument
                    ? notebookDocument.uri.toString()
                    : undefined,
                notebookVersion: notebookDocument
                    ? notebookDocument.version
                    : undefined,
                notebookCells,
            },
        )
    }

    changeHotspotStatus(
        hotspotKey: string,
        newStatus: string,
        fileUri: string,
    ): Promise<void> {
        return this.sendNotification(protocol.SetHotspotStatus.type, {
            hotspotKey,
            newStatus,
            fileUri,
        })
    }

    checkLocalHotspotsDetectionSupported(
        folderUri: string,
    ): Promise<protocol.CheckLocalDetectionSupportedResponse> {
        return this.sendRequest(protocol.CheckLocalDetectionSupported.type, {
            uri: folderUri,
        })
    }

    getHotspotDetails(
        ruleKey: string,
        hotspotId: string,
        fileUri: string,
    ): Promise<protocol.ShowRuleDescriptionParams> {
        return this.sendRequest(protocol.GetHotspotDetails.type, {
            ruleKey,
            hotspotId,
            fileUri,
        })
    }

    didCreateBinding(mode: protocol.BindingCreationMode): Promise<void> {
        return this.sendNotification(protocol.DidCreateBinding.type, mode)
    }
}
