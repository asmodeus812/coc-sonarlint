/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import * as coc from "coc.nvim"

export namespace ShowRuleDescriptionNotification {
    export const type = new coc.NotificationType<ShowRuleDescriptionParams>(
        "sonarlint/showRuleDescription",
    )
}

export namespace SuggestBindingNotification {
    export const type = new coc.NotificationType<SuggestBindingParams>(
        "sonarlint/suggestBinding",
    )
}

export interface SuggestBindingParams {
    suggestions: {
        [folderUri: string]: Array<BindingSuggestion>
    }
}

export interface BindingSuggestion {
    connectionId: string
    sonarProjectKey: string
    sonarProjectName: string
    isFromSharedConfiguration: boolean
}

export interface ListFilesInScopeResponse {
    foundFiles: Array<FoundFileDto>
}

export interface FolderUriParams {
    folderUri: string
}

export namespace ListFilesInFolderRequest {
    export const type = new coc.RequestType<
        FolderUriParams,
        ListFilesInScopeResponse,
        List
    >("sonarlint/listFilesInFolder")
}

export interface FoundFileDto {
    fileName: string
    filePath: string
    content?: string
}

export namespace ShowHotspotRuleDescriptionNotification {
    export const type =
        new coc.NotificationType<ShowHotspotRuleDescriptionNotificationParams>(
            "sonarlint/showHotspotRuleDescription",
        )
}

export interface ShowHotspotRuleDescriptionNotificationParams {
    ruleKey: string
    hotspotId: string
    fileUri: string
}

export interface ShowRuleDescriptionParams {
    key: string
    name: string
    htmlDescription: string
    htmlDescriptionTabs: Array<{
        title: string
        ruleDescriptionTabNonContextual?: {
            htmlContent: string
        }
        ruleDescriptionTabContextual?: Array<{
            htmlContent: string
            contextKey: string
            displayName: string
        }>
        hasContextualInformation: boolean
        defaultContextKey?: string
    }>
    type: string
    severity: string
    cleanCodeAttribute?: string
    cleanCodeAttributeCategory?: string
    impacts?: { [softwareQuality: string]: string }
    languageKey: string
    isTaint: boolean
    parameters?: Array<{
        name: string
        description: string
        defaultValue: string
    }>
}

export namespace GetJavaConfigRequest {
    export const type = new coc.RequestType<string, GetJavaConfigResponse, void>(
        "sonarlint/getJavaConfig",
    )
}

export namespace ScmCheckRequest {
    export const type = new coc.RequestType<string, boolean, void>(
        "sonarlint/isIgnoredByScm",
    )
}

export namespace ShowNotificationForFirstSecretsIssueNotification {
    export const type = new coc.NotificationType(
        "sonarlint/showNotificationForFirstSecretsIssue",
    )
}

export interface GetJavaConfigResponse {
    projectRoot: string
    sourceLevel: string
    classpath: string[]
    isTest: boolean
    vmLocation: string
}

export namespace ShowSonarLintOutputNotification {
    export const type = new coc.NotificationType("sonarlint/showSonarLintOutput")
}

export namespace OpenJavaHomeSettingsNotification {
    export const type = new coc.NotificationType(
        "sonarlint/openJavaHomeSettings",
    )
}

export namespace OpenPathToNodeSettingsNotification {
    export const type = new coc.NotificationType(
        "sonarlint/openPathToNodeSettings",
    )
}

export namespace BrowseToNotification {
    export const type = new coc.NotificationType<string>("sonarlint/browseTo")
}

export namespace OpenConnectionSettingsNotification {
    export const type = new coc.NotificationType<boolean>(
        "sonarlint/openConnectionSettings",
    )
}

export enum HotspotResolution {
    Fixed,
    Safe,
    Acknowledged,
}

export enum HotspotProbability {
    high,
    medium,
    low,
}

export enum HotspotStatus {
    ToReview,
    Reviewed,
}

export enum ExtendedHotspotStatus {
    ToReview,
    Safe,
    Fixed,
    Acknowledged,
}

export interface RemoteHotspot {
    message: string
    ideFilePath: string
    key: string
    textRange: TextRange
    author: string
    status: string
    resolution?: HotspotResolution
    rule: {
        key: string
        name: string
        securityCategory: string
        vulnerabilityProbability: HotspotProbability
        riskDescription: string
        vulnerabilityDescription: string
        fixRecommendations: string
    }
}

export namespace ShowHotspotNotification {
    export const type = new coc.NotificationType<RemoteHotspot>(
        "sonarlint/showHotspot",
    )
}

export namespace ShowIssueNotification {
    export const type = new coc.NotificationType<Issue>("sonarlint/showIssue")
}

export interface TextRange {
    startLine: number
    endLine?: number
    startLineOffset?: number
    endLineOffset?: number
}

export interface Location {
    uri?: string
    filePath: string
    textRange: TextRange
    message?: string
    exists: boolean
    codeMatches: boolean
}

export interface Flow {
    locations: Location[]
}

export interface Issue {
    fileUri: string
    message: string
    ruleKey: string
    connectionId?: string
    creationDate?: string
    flows: Flow[]
    textRange: TextRange
    codeMatches?: boolean
    shouldOpenRuleDescription: boolean
}

export namespace ShowIssueOrHotspotNotification {
    export const type = new coc.NotificationType<Issue>(
        "sonarlint/showIssueOrHotspot",
    )
}

export interface BranchNameForFolder {
    folderUri: string
    branchName?: string
}

export namespace SetReferenceBranchNameForFolderNotification {
    export const type = new coc.NotificationType<BranchNameForFolder>(
        "sonarlint/setReferenceBranchNameForFolder",
    )
}

export namespace NeedCompilationDatabaseRequest {
    export const type = new coc.NotificationType(
        "sonarlint/needCompilationDatabase",
    )
}

export interface ShouldAnalyseFileCheckResult {
    shouldBeAnalysed: boolean
    reason?: string
}

export namespace IsOpenInEditor {
  export const type = new coc.RequestType<string, boolean, void>('sonarlint/isOpenInEditor');
}

export namespace ShouldAnalyseFileCheck {
    export const type = new coc.RequestType<
        UriParams,
        ShouldAnalyseFileCheckResult,
        void
    >("sonarlint/shouldAnalyseFile")
}

export interface FileUris {
    fileUris: string[]
}

export namespace FilterOutExcludedFiles {
    export const type = new coc.RequestType<FileUris, FileUris, void>(
        "sonarlint/filterOutExcludedFiles",
    )
}

export interface ConnectionCheckResult {
    connectionId: string
    success: boolean
    reason?: string
}

export interface ConnectionCheckParams {
    connectionId?: string
    token?: string
    organization?: string
    serverUrl?: string
}

export namespace ReportConnectionCheckResult {
    export const type = new coc.NotificationType<ConnectionCheckResult>(
        "sonarlint/reportConnectionCheckResult",
    )
}

export namespace CheckConnection {
    export const type = new coc.RequestType<
        ConnectionCheckParams,
        ConnectionCheckResult,
        void
    >("sonarlint/checkConnection")
}

export interface AnalysisFile {
    uri: string
    languageId: string
    version: number
    text: string
}

export interface CheckLocalDetectionSupportedResponse {
    isSupported: boolean
    reason?: string
}

export namespace CheckLocalDetectionSupported {
    export const type = new coc.RequestType<
        UriParams,
        CheckLocalDetectionSupportedResponse,
        null
    >("sonarlint/checkLocalDetectionSupported")
}

export namespace GetHotspotDetails {
    export const type = new coc.RequestType<
        ShowHotspotRuleDescriptionNotificationParams,
        ShowRuleDescriptionParams,
        null
    >("sonarlint/getHotspotDetails")
}

export namespace CanShowMissingRequirementNotification {
    export const type = new coc.RequestType<string, boolean, void>(
        "sonarlint/canShowMissingRequirementsNotification",
    )
}

export namespace MaybeShowWiderLanguageSupportNotification {
    export const type = new coc.NotificationType<string[]>(
        "sonarlint/maybeShowWiderLanguageSupportNotification",
    )
}

//#endregion

//#region Server side extensions to LSP

export interface DidClasspathUpdateParams {
    projectUri: string
}

export namespace DidClasspathUpdateNotification {
    export const type = new coc.NotificationType<DidClasspathUpdateParams>(
        "sonarlint/didClasspathUpdate",
    )
}

export interface DidJavaServerModeChangeParams {
    serverMode: string
}

export namespace DidJavaServerModeChangeNotification {
    export const type = new coc.NotificationType<DidJavaServerModeChangeParams>(
        "sonarlint/didJavaServerModeChange",
    )
}

export interface DidLocalBranchNameChangeParams {
    folderUri: string
    branchName?: string
}

export namespace DidLocalBranchNameChangeNotification {
    export const type = new coc.NotificationType<DidLocalBranchNameChangeParams>(
        "sonarlint/didLocalBranchNameChange",
    )
}

export type ConfigLevel = "on" | "off"

export interface Rule {
    readonly key: string
    readonly name: string
    readonly activeByDefault: boolean
    levelFromConfig?: ConfigLevel
}

export interface RulesResponse {
    [language: string]: Array<Rule>
}

export namespace ListAllRulesRequest {
    export const type = new coc.RequestType0<RulesResponse, void>(
        "sonarlint/listAllRules",
    )
}

export namespace GetTokenForServer {
    export const type = new coc.RequestType<string, string, void>(
        "sonarlint/getTokenForServer",
    )
}

export interface TokenUpdateNotificationParams {
    connectionId: string
    token: string
}

export namespace OnTokenUpdate {
    export const type = new coc.NotificationType<TokenUpdateNotificationParams>(
        "sonarlint/onTokenUpdate",
    )
}

export interface GetRemoteProjectsForConnectionParams {
    connectionId: string
}

export namespace GetRemoteProjectsForConnection {
    export const type = new coc.RequestType<
        GetRemoteProjectsForConnectionParams,
        Map<string, string>,
        void
    >("sonarlint/getRemoteProjectsForConnection")
}

interface GetRemoteProjectNamesParams {
    connectionId?: string
    projectKeys: Array<string>
}

export namespace GetRemoteProjectNames {
    export const type = new coc.RequestType<
        GetRemoteProjectNamesParams,
        { [key: string]: string },
        null
    >("sonarlint/getRemoteProjectNames")
}

export interface GenerateTokenParams {
    baseServerUrl: string
}

export interface GenerateTokenResponse {
    token?: string
}

export namespace GenerateToken {
    export const type = new coc.RequestType<
        GenerateTokenParams,
        GenerateTokenResponse,
        null
    >("sonarlint/generateToken")
}

export interface Diagnostic extends coc.Diagnostic {
    creationDate?: string
    flows: Flow[]
}

export interface PublishHotspotsForFileParams {
    uri: string
    diagnostics: Diagnostic[]
}

export namespace PublishHotspotsForFile {
    export const type = new coc.NotificationType<PublishHotspotsForFileParams>(
        "sonarlint/publishSecurityHotspots",
    )
}

export interface ShowHotspotLocationsParams {
    hotspotKey: string
    fileUri: string
}

export namespace ShowHotspotLocations {
    export const type = new coc.RequestType<
        ShowHotspotLocationsParams,
        null,
        null
    >("sonarlint/showHotspotLocations")
}

export interface OpenHotspotParams {
    hotspotId: string
    fileUri: string
}

export namespace OpenHotspotOnServer {
    export const type = new coc.NotificationType<OpenHotspotParams>(
        "sonarlint/openHotspotInBrowser",
    )
}

export interface HelpAndFeedbackLinkClickedNotificationParams {
    id: string
}

export namespace HelpAndFeedbackLinkClicked {
    export const type =
        new coc.NotificationType<HelpAndFeedbackLinkClickedNotificationParams>(
            "sonarlint/helpAndFeedbackLinkClicked",
        )
}

export interface ScanFolderForHotspotsParams {
    folderUri: string
    documents: Array<coc.TextDocumentItem>
}

export namespace ScanFolderForHotspots {
    export const type = new coc.NotificationType<ScanFolderForHotspotsParams>(
        "sonarlint/scanFolderForHotspots",
    )
}

export namespace ForgetFolderHotspots {
    export const type = new coc.NotificationType(
        "sonarlint/forgetFolderHotspots",
    )
}

export interface UriParams {
    uri: string
}

export interface GetFilePatternsForAnalysisResponse {
    patterns: string[]
}

export namespace GetFilePatternsForAnalysis {
    export const type = new coc.RequestType<
        UriParams,
        GetFilePatternsForAnalysisResponse,
        null
    >("sonarlint/listSupportedFilePatterns")
}

export interface GetSuggestedBindingParams {
    configScopeId: string
    connectionId: string
}

export interface GetSuggestedBindingResponse {
    suggestions: {
        [folderUri: string]: Array<BindingSuggestion>
    }
}

export namespace GetSuggestedBinding {
    export const type = new coc.RequestType<
        GetSuggestedBindingParams,
        GetSuggestedBindingResponse,
        null
    >("sonarlint/getBindingSuggestion")
}

export interface GetSharedConnectedModeConfigFileParams {
    configScopeId: string
}

export interface GetSharedConnectedModeConfigFileResponse {
    jsonFileContent: string
}

export namespace GetSharedConnectedModeConfigFileContents {
    export const type = new coc.RequestType<
        GetSharedConnectedModeConfigFileParams,
        GetSharedConnectedModeConfigFileResponse,
        null
    >("sonarlint/getSharedConnectedModeFileContent")
}

export namespace ReopenResolvedLocalIssues {
    export const type = new coc.NotificationType<ReopenAllIssuesForFileParams>(
        "sonarlint/reopenResolvedLocalIssues",
    )
}

export interface ReopenAllIssuesForFileParams {
    configurationScopeId: string
    relativePath: string
    fileUri: string
}

export interface CheckIssueStatusChangePermittedParams {
    folderUri: string
    issueKey: string
}

export interface CheckIssueStatusChangePermittedResponse {
    permitted: boolean
    notPermittedReason: string
    allowedStatuses: string[]
}

export namespace CheckIssueStatusChangePermitted {
    export const type = new coc.RequestType<
        CheckIssueStatusChangePermittedParams,
        CheckIssueStatusChangePermittedResponse,
        null
    >("sonarlint/checkIssueStatusChangePermitted")
}

export namespace SetIssueStatus {
    export const type = new coc.NotificationType<SetIssueStatusParams>(
        "sonarlint/changeIssueStatus",
    )
}

export interface SetIssueStatusParams {
    configurationScopeId: string
    issueId: string
    newStatus: string
    fileUri: string
    comment: string
    isTaintIssue: boolean
}

export interface AssistCreatingConnectionParams {
    isSonarCloud: boolean
    serverUrl: string
    token: string
}

export interface AssistCreatingConnectionResponse {
    newConnectionId: string
}

export namespace AssistCreatingConnection {
    export const type = new coc.RequestType<
        AssistCreatingConnectionParams,
        AssistCreatingConnectionResponse,
        null
    >("sonarlint/assistCreatingConnection")
}

export interface AssistBindingParams {
    connectionId: string
    projectKey: string
    isFromSharedConfiguration: boolean
}

export interface AssistBindingResponse {
    configurationScopeId: string
}

export namespace AssistBinding {
    export const type = new coc.RequestType<
        AssistBindingParams,
        AssistBindingResponse,
        null
    >("sonarlint/assistBinding")
}

interface ShowHotspotDetailsParams {
    hotspotKey: string
}

export namespace ShowHotspotDetails {
    export const type = new coc.NotificationType<ShowHotspotDetailsParams>(
        "sonarlint/showHotspotDetails",
    )
}

export interface GetAllowedHotspotStatusesResponse {
    permitted: boolean
    notPermittedReason: string
    allowedStatuses: string[]
}

export interface GetAllowedHotspotStatusesParams {
    fileUri: string
    folderUri: string
    hotspotKey: string
}

export namespace GetAllowedHotspotStatuses {
    export const type = new coc.RequestType<
        GetAllowedHotspotStatusesParams,
        GetAllowedHotspotStatusesResponse,
        null
    >("sonarlint/getAllowedHotspotStatuses")
}

export interface SetHotspotStatusParams {
    hotspotKey: string
    newStatus: string
    fileUri: string
}

export namespace SetHotspotStatus {
    export const type = new coc.NotificationType<SetHotspotStatusParams>(
        "sonarlint/changeHotspotStatus",
    )
}

export interface SslCertificateConfirmationParams {
    issuedTo: string
    issuedBy: string
    validFrom: string
    validTo: string
    sha1Fingerprint: string
    sha256Fingerprint: string
    truststorePath: string
}

export namespace SslCertificateConfirmation {
    export const type = new coc.RequestType<
        SslCertificateConfirmationParams,
        boolean,
        void
    >("sonarlint/askSslCertificateConfirmation")
}

export interface AnalyseOpenFileIgnoringExcludesParams {
    textDocument?: AnalysisFile
    notebookUri?: string
    notebookVersion?: number
    notebookCells?: AnalysisFile[]
}

export namespace AnalyseOpenFileIgnoringExcludes {
    export const type =
        new coc.NotificationType<AnalyseOpenFileIgnoringExcludesParams>(
            "sonarlint/analyseOpenFileIgnoringExcludes",
        )
}

export interface ShowSoonUnsupportedVersionMessageParams {
    doNotShowAgainId: string
    text: string
}

export namespace ShowSoonUnsupportedVersionMessage {
    export const type =
        new coc.NotificationType<ShowSoonUnsupportedVersionMessageParams>(
            "sonarlint/showSoonUnsupportedVersionMessage",
        )
}

export interface SubmitNewCodeDefinitionParams {
    folderUri: string
    newCodeDefinitionOrMessage: string
    isSupported: boolean
}

export namespace SubmitNewCodeDefinition {
    export const type = new coc.NotificationType<SubmitNewCodeDefinitionParams>(
        "sonarlint/submitNewCodeDefinition",
    )
}

export interface ConnectionSuggestion {
    connectionSuggestion: {
        serverUrl?: string
        organization?: string
        projectKey: string
    }
    isFromSharedConfiguration: boolean
}

export interface SuggestConnectionParams {
    suggestionsByConfigScopeId: {
        [folderUri: string]: Array<ConnectionSuggestion>
    }
}

export namespace SuggestConnection {
    export const type = new coc.NotificationType<SuggestConnectionParams>(
        "sonarlint/suggestConnection",
    )
}

export enum BindingCreationMode {
    AUTOMATIC,
    IMPORTED,
    MANUAL,
}

export namespace DidCreateBinding {
    export const type = new coc.NotificationType<BindingCreationMode>(
        "sonarlint/didCreateBinding",
    )
}

//#endregion
