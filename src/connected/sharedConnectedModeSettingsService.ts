/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as fse from "fs";
import * as coc from "coc.nvim";
import * as path from "path";
import { TextEncoder } from "util";
import { FileSystemServiceImpl } from "../fileSystem/fileSystemServiceImpl";
import { FileSystemSubscriber } from "../fileSystem/fileSystemSubscriber";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import { ConnectionSuggestion } from "../lsp/protocol";
import { shouldShowRegionSelection } from "../settings/settings";
import { CustomQuickPickItem, deduplicateSuggestions } from "../util/connectionSuggestionUtils";
import { logToSonarLintOutput } from "../util/logging";
import { code2ProtocolConverter } from "../util/uri";
import { sonarCloudRegionToLabel } from "../util/util";
import { connectToSonarCloud, connectToSonarQube } from "./connectionsetup";

const MAX_FOLDERS_TO_NOTIFY = 1;
const DO_NOT_ASK_ABOUT_CONNECTION_SETUP_FOR_WORKSPACE = "doNotAskAboutConnectionSetupForWorkspace";

const USE_CONFIGURATION_ACTION = "Use Configuration";
const DONT_ASK_AGAIN_ACTION = "Don't Ask Again";

const SOLUTION_FILE_SUFFIX_LENGTH = -4;

export class SharedConnectedModeSettingsService implements FileSystemSubscriber {
    private static _instance: SharedConnectedModeSettingsService;
    public static readonly SHARED_CONNECTED_MODE_CONFIG_FOLDER = ".sonarlint";
    public static readonly SHARED_CONNECTED_MODE_CONFIG_GENERIC_FILE = "connectedMode.json";
    private readonly solutionFilesByConfigScope: Map<string, string[]> = new Map<string, string[]>();

    static init(
        languageClient: SonarLintExtendedLanguageClient,
        fileSystemService: FileSystemServiceImpl,
        context: coc.ExtensionContext,
        factory: coc.FloatFactory
    ): void {
        SharedConnectedModeSettingsService._instance = new SharedConnectedModeSettingsService(languageClient, context, factory);
        fileSystemService.subscribe(SharedConnectedModeSettingsService._instance);
    }

    constructor(
        private readonly languageClient: SonarLintExtendedLanguageClient,
        private readonly context: coc.ExtensionContext,
        private readonly factory: coc.FloatFactory
    ) {}

    static get instance(): SharedConnectedModeSettingsService {
        return SharedConnectedModeSettingsService._instance;
    }

    onFile(folderUri: string, fileName: string, _fullFileUri: coc.Uri) {
        if (folderUri && !this.solutionFilesByConfigScope.get(folderUri)) {
            this.solutionFilesByConfigScope.set(folderUri, []);
        }
        if (fileName.endsWith(".sln")) {
            const friendlySolutionName = fileName.slice(0, SOLUTION_FILE_SUFFIX_LENGTH);
            this.solutionFilesByConfigScope.get(folderUri)?.push(friendlySolutionName);
        }
    }
    didRemoveWorkspaceFolder(workspaceFolderUri: coc.Uri) {
        this.solutionFilesByConfigScope.set(workspaceFolderUri.toString(), []);
    }

    handleSuggestConnectionNotification(connectedModeSuggestions: { [configScopeId: string]: Array<ConnectionSuggestion> }) {
        const configScopeIds = Object.keys(connectedModeSuggestions);
        if (configScopeIds.length > MAX_FOLDERS_TO_NOTIFY) {
            logToSonarLintOutput(`Received connection suggestions for too many folders, skipping`);
        }
        configScopeIds.forEach((configScopeId) =>
            this.suggestConnectionForConfigScope(configScopeId, connectedModeSuggestions[configScopeId])
        );
    }

    private async suggestConnectionForConfigScope(configScopeId: string, suggestions: Array<ConnectionSuggestion>) {
        if (this.context.workspaceState.get(DO_NOT_ASK_ABOUT_CONNECTION_SETUP_FOR_WORKSPACE)) {
            // Ignore silently since user asked not to be bothered again
            return;
        }
        const workspaceFolder = tryGetWorkspaceFolder(configScopeId);
        if (workspaceFolder === undefined) {
            logToSonarLintOutput(`Ignoring connection suggestion for unknown folder ${configScopeId}`);
            return;
        }
        if (suggestions.length === 0) {
            logToSonarLintOutput(`Ignoring empty suggestions for ${configScopeId}`);
        } else if (suggestions.length === 1) {
            this.suggestBindSingleOption(suggestions[0], workspaceFolder);
        } else {
            // multiple suggestions for the same config scope
            // deduplicate suggestions first
            const uniqueSuggestions = deduplicateSuggestions(suggestions);
            if (uniqueSuggestions.length === 1) {
                this.suggestBindSingleOption({ connectionSuggestion: uniqueSuggestions[0] } as ConnectionSuggestion, workspaceFolder);
            } else {
                this.suggestBindingMultiOption(uniqueSuggestions, workspaceFolder);
            }
        }
    }

    severalSharedConfigPoposalHandler(uniqueSuggestions: any[], workspaceFolder: coc.WorkspaceFolder) {
        return async () => {
            const quickPickItems: CustomQuickPickItem[] = uniqueSuggestions.map((s: any) => {
                const regionPrefix = s.organization && shouldShowRegionSelection() ? `[${sonarCloudRegionToLabel(s.region)}] ` : "";
                return {
                    label: s.projectKey,
                    description: s.organization || s.serverUrl,
                    detail: s.organization ? `${regionPrefix}SonarQube Cloud` : "SonarQube Server",
                    data: { region: sonarCloudRegionToLabel(s.region) }
                };
            });
            const selectedConfig = await coc.window.showQuickPick(quickPickItems, {
                title: `Which project would you like to bind with the folder '${workspaceFolder.name}/'`
            });
            if (selectedConfig?.description?.includes("SonarQube Cloud")) {
                await connectToSonarCloud(this.context, this.factory)(
                    selectedConfig.description,
                    selectedConfig.label,
                    false,
                    selectedConfig.data?.region,
                    coc.Uri.parse(workspaceFolder.uri)
                );
            } else if (selectedConfig?.description === "SonarQube Server") {
                await connectToSonarQube(this.context, this.factory)(
                    selectedConfig.description,
                    selectedConfig.label,
                    false,
                    coc.Uri.parse(workspaceFolder.uri)
                );
            }
        };
    }

    private async suggestBindingMultiOption(uniqueSuggestions, workspaceFolder) {
        const message = `Multiple Connected Mode
       configuration files are available to bind folder '${workspaceFolder.name}'
        to a Sonar server. Do you want to use the shared configuration?`;

        await this.suggestBinding(message, this.severalSharedConfigPoposalHandler(uniqueSuggestions, workspaceFolder));
    }

    private async suggestBindSingleOption(suggestion: ConnectionSuggestion, workspaceFolder: coc.WorkspaceFolder) {
        const { projectKey, serverUrl, organization, region } = suggestion.connectionSuggestion;
        const isFromSharedConfiguration = suggestion.isFromSharedConfiguration;
        const serverReference = organization ? `of SonarQube Cloud organization '${organization}'` : `on SonarQube Server '${serverUrl}'`;
        const message = `A Connected Mode configuration file is available to bind folder '${workspaceFolder.name}'
        to project '${projectKey}' ${serverReference}. Do you want to use this configuration file to bind this project?`;
        const useConfigurationHandler = async () => {
            if (organization) {
                connectToSonarCloud(this.context, this.factory)(
                    organization,
                    projectKey,
                    isFromSharedConfiguration,
                    sonarCloudRegionToLabel(region as number),
                    coc.Uri.parse(workspaceFolder.uri)
                );
            } else {
                connectToSonarQube(this.context, this.factory)(
                    serverUrl,
                    projectKey,
                    isFromSharedConfiguration,
                    coc.Uri.parse(workspaceFolder.uri)
                );
            }
        };
        await this.suggestBinding(message, useConfigurationHandler);
    }

    private async suggestBinding(proposalMessage: string, useConfigurationAction: () => Promise<void>) {
        const actions = [USE_CONFIGURATION_ACTION, DONT_ASK_AGAIN_ACTION];
        const userAnswer = await coc.window.showInformationMessage(proposalMessage, ...actions);

        switch (userAnswer) {
            case USE_CONFIGURATION_ACTION:
                await useConfigurationAction();
                break;
            case DONT_ASK_AGAIN_ACTION:
                this.context.workspaceState.update(DO_NOT_ASK_ABOUT_CONNECTION_SETUP_FOR_WORKSPACE, true);
                break;
            default:
            // NOP
        }
    }

    async askConfirmationAndCreateSharedConnectedModeSettingsFile(workspaceFolder: coc.WorkspaceFolder) {
        const SHARE_ACTION = "Share Configuration";
        const userConfirmation = await coc.window.showInformationMessage(
            "Share this Connected Mode configuration ? A configuration file will be created in this working directory, making it easier for other team members to configure the binding for the same project.",
            SHARE_ACTION
        );
        if (userConfirmation === SHARE_ACTION) {
            await this.createSharedConnectedModeSettingsFile(workspaceFolder);
        } else {
            return;
        }
    }

    async createSharedConnectedModeSettingsFile(workspaceFolder: coc.WorkspaceFolder) {
        const configScopeId = code2ProtocolConverter(coc.Uri.parse(workspaceFolder.uri));
        const fileContents = await this.languageClient.getSharedConnectedModeConfigFileContent(configScopeId);
        const fileName = await this.computeSharedConnectedModeFileName(workspaceFolder.uri.toString());
        if (!fileName) {
            logToSonarLintOutput("Sharing Connected Mode configuration failed. File name is null");
            coc.window.showErrorMessage("Failed to create Sonarlint Connected Mode configuration file.");
            return;
        }
        const destinationUri = coc.Uri.file(
            path.join(
                coc.Uri.parse(workspaceFolder.uri).fsPath,
                SharedConnectedModeSettingsService.SHARED_CONNECTED_MODE_CONFIG_FOLDER,
                fileName
            )
        );
        try {
            fse.writeFileSync(destinationUri.fsPath, new TextEncoder().encode(fileContents.jsonFileContent));
            coc.window.showInformationMessage("Sonarlint Connected Mode configuration file was created.");
        } catch (e) {
            coc.window.showErrorMessage("Failed to create Sonarlint Connected Mode configuration file.");
            logToSonarLintOutput(`Error writing Sonarlint configuration file: ${e}`);
        }
    }

    async computeSharedConnectedModeFileName(workspaceFolderUri: string): Promise<string | undefined> {
        try {
            const solutionByScope: any = this.solutionFilesByConfigScope.get(workspaceFolderUri);
            if (solutionByScope?.length === 0) {
                return SharedConnectedModeSettingsService.SHARED_CONNECTED_MODE_CONFIG_GENERIC_FILE;
            } else if (solutionByScope?.length === 1) {
                return `${solutionByScope[0]}.json`;
            } else {
                const selectedSolutionName = await coc.window.showQuickPick(
                    solutionByScope.map((i: string) => {
                        return { label: i };
                    }),
                    {
                        title: "For which Solution would you like to export Sonarlint binding configuration?",
                        placeHolder:
                            "A configuration file corresponding to the selected Solution will be created in this working directory."
                    }
                );
                return selectedSolutionName ? `${selectedSolutionName}.json` : undefined;
            }
        } catch (error) {
            coc.window.showErrorMessage("Failed to compute shared connected mode mod");
            logToSonarLintOutput(`Error computing shared connected mode: ${error}`);
            return undefined;
        }
    }
}

function tryGetWorkspaceFolder(configScopeId: string) {
    try {
        return coc.workspace.getWorkspaceFolder(coc.Uri.parse(configScopeId));
    } catch (notUriError) {
        coc.window.showErrorMessage(`Failed failed to get workspace folder ${configScopeId}`);
        logToSonarLintOutput(`Error finding the workspace folder: ${configScopeId} ${notUriError}`);
        return undefined;
    }
}
