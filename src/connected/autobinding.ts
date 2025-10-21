/* -------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

"use strict";

import * as coc from "coc.nvim";
import * as fse from "fs";
import * as Path from "path";
import { DEFAULT_CONNECTION_ID, SonarLintDocumentation } from "../commons";
import { FileSystemServiceImpl } from "../fileSystem/fileSystemServiceImpl";
import { FileSystemSubscriber } from "../fileSystem/fileSystemSubscriber";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import { BindingSuggestion, ExtendedClient, ExtendedServer } from "../lsp/protocol";
import { ConnectionSettingsService, SonarCloudConnection, SonarQubeConnection } from "../settings/connectionsettings";
import { DONT_ASK_AGAIN_ACTION } from "../util/showMessage";
import { code2ProtocolConverter } from "../util/uri";
import { BindingService } from "./binding";
import { ServerType } from "./connections";
import { logToSonarLintOutput } from "../util/logging";

const AUTOBINDING_THRESHOLD = 1;
const BIND_ACTION = "Configure Binding";
const CHOOSE_MANUALLY_ACTION = "Choose Manually";
const SONAR_SCANNER_CONFIG_FILENAME = "sonar-project.properties";
const AUTOSCAN_CONFIG_FILENAME = ".sonarcloud.properties";
export const DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_WS_FLAG = "doNotAskAboutAutoBindingForWorkspace";
export const DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_FOLDER_FLAG = "doNotAskAboutAutoBindingForFolder";
const CONFIGURE_BINDING_PROMPT_MESSAGE = `There are folders in your workspace that are not bound to any SonarQube (Server, Cloud) projects.
      Do you want to configure binding?
      [Learn More](${SonarLintDocumentation.CONNECTED_MODE})`;

const CONFIGURE_BINDING_MANUALLY_PROMPT_MESSAGE = `Sonarlint could not find any binding suggestions for SonarQube (Server, Cloud) projects.
      Do you want to configure binding manually?
      [Learn More](${SonarLintDocumentation.CONNECTED_MODE})`;

export class AutoBindingService implements FileSystemSubscriber {
    private static _instance: AutoBindingService;
    private readonly filesPerConfigScope = new Map<string, ExtendedClient.FoundFileDto[]>();

    static init(
        bindingService: BindingService,
        workspaceState: coc.Memento,
        settingsService: ConnectionSettingsService,
        fileSystemService: FileSystemServiceImpl,
        languageClient: SonarLintExtendedLanguageClient
    ): void {
        AutoBindingService._instance = new AutoBindingService(bindingService, workspaceState, settingsService, languageClient);
        fileSystemService.subscribe(AutoBindingService._instance);
    }

    constructor(
        private readonly bindingService: BindingService,
        private readonly workspaceState: coc.Memento,
        private readonly settingsService: ConnectionSettingsService,
        private readonly languageClient: SonarLintExtendedLanguageClient
    ) {}

    static get instance(): AutoBindingService {
        return AutoBindingService._instance;
    }

    async checkConditionsAndAttemptAutobinding(params: ExtendedClient.SuggestBindingParams) {
        const bindingSuggestionsPerConfigScope = params.suggestions;
        if (
            !this.isConnectionConfigured() || // no connections
            this.workspaceState.get(DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_WS_FLAG) // don't ask again
        ) {
            return;
        }
        if (Object.keys(bindingSuggestionsPerConfigScope).length > AUTOBINDING_THRESHOLD) {
            await this.askUserBeforeAutoBinding();
        } else {
            this.autoBindAllFolders(bindingSuggestionsPerConfigScope);
        }
    }

    async autoBindWorkspace() {
        if (coc.workspace.workspaceFolders && this.isConnectionConfigured()) {
            const unboundFolders = coc.workspace.workspaceFolders.filter(
                (workspaceFolder) => !this.bindingService.isBound(workspaceFolder)
            );
            if (unboundFolders.length > 0) {
                const folderToBind = unboundFolders.length === 1 ? unboundFolders[0] : await this.selectFolderToBind(unboundFolders);
                if (!folderToBind) {
                    return;
                }
                this.autoBindSelectedFolder(folderToBind);
            } else {
                coc.window.showInformationMessage(`All folders in this workspace are already bound
         to SonarQube (Server, Cloud) projects`);
            }
        } else if (!this.isConnectionConfigured()) {
            coc.window.showWarningMessage(
                `"Bind all workspace folders to SonarQube (Server, Cloud)"
      can only be invoked if a SonarQube (Server, Cloud) connection exists`
            );
        } else {
            coc.window.showWarningMessage(`"Bind all workspace folders to SonarQube (Server, Cloud)"
      can only be invoked on an open workspace`);
        }
    }

    private async autoBindSelectedFolder(folderToBind: coc.WorkspaceFolder) {
        const configScopeId = code2ProtocolConverter(coc.Uri.parse(folderToBind.uri));
        const targetConnection = await this.getTargetConnectionForManualBinding();
        if (!targetConnection) {
            return;
        }
        const connectionId = targetConnection.connectionId;
        const suggestedBinding = await this.languageClient.getSuggestedBinding(configScopeId, connectionId);
        if (suggestedBinding?.suggestions?.[configScopeId]) {
            await this.promptToAutoBind(suggestedBinding.suggestions[configScopeId], folderToBind);
        }
        await coc.window.showInformationMessage(`Auto binding workspace folder ${folderToBind.name}`);
    }

    private async selectFolderToBind(unboundFolders: coc.WorkspaceFolder[]): Promise<coc.WorkspaceFolder | undefined> {
        const folderNames = unboundFolders.map((folder) => folder.name);
        const folderNameToBind = await coc.window.showQuickPick(folderNames, {
            title: "Select Folder to Bind",
            placeHolder: "Select the folder to bind to a SonarQube (Server, Cloud) project"
        });
        return unboundFolders.find((folder) => folder.name === folderNameToBind);
    }

    private autoBindAllFolders(bindingSuggestions: { [folderUri: string]: Array<BindingSuggestion> }) {
        const foldersNotToAutoBound = this.getFoldersThatShouldNotBeAutoBound();
        Object.keys(bindingSuggestions).forEach((folderUri) => {
            const workspaceFolder = coc.workspace.getWorkspaceFolder(coc.Uri.parse(folderUri));
            if (workspaceFolder && !foldersNotToAutoBound.includes(workspaceFolder.uri.toString())) {
                this.promptToAutoBind(bindingSuggestions[folderUri], workspaceFolder);
            }
        });
    }

    isConnectionConfigured(): boolean {
        const sonarCloudConnections = this.settingsService.getSonarCloudConnections();
        const sonarQubeConnections = this.settingsService.getSonarQubeConnections();
        return sonarCloudConnections.length > 0 || sonarQubeConnections.length > 0;
    }

    private getFoldersThatShouldNotBeAutoBound(): string[] {
        return this.workspaceState.get<string[]>(DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_FOLDER_FLAG, []);
    }

    async getTargetConnectionForManualBinding() {
        const sonarQubeConnections = this.settingsService.getSonarQubeConnections();
        const sonarCloudConnections = this.settingsService.getSonarCloudConnections();
        let targetConnection: any;
        if (sonarCloudConnections.length === 0 && sonarQubeConnections.length === 1) {
            targetConnection = {
                label: this.computeItemLabel(ServerType.SonarQube, sonarQubeConnections[0]),
                description: "SonarQube Server",
                connectionId: this.computeConnectionId(sonarQubeConnections[0]),
                contextValue: "sonarqubeConnection"
            };
        } else if (sonarQubeConnections.length === 0 && sonarCloudConnections.length === 1) {
            targetConnection = {
                label: this.computeItemLabel(ServerType.SonarCloud, sonarCloudConnections[0]),
                description: "SonarQube Cloud",
                connectionId: this.computeConnectionId(sonarCloudConnections[0]),
                contextValue: "sonarcloudConnection"
            };
        } else {
            const connectionNames: any[] = [];
            sonarQubeConnections.forEach((c) => {
                connectionNames.push({
                    label: this.computeItemLabel(ServerType.SonarQube, c),
                    description: "SonarQube Server",
                    connectionId: this.computeConnectionId(c),
                    contextValue: "sonarqubeConnection"
                });
            });
            sonarCloudConnections.forEach((c) => {
                connectionNames.push({
                    label: this.computeItemLabel(ServerType.SonarCloud, c),
                    description: "SonarQube Cloud",
                    connectionId: this.computeConnectionId(c),
                    contextValue: "sonarcloudConnection"
                });
            });
            targetConnection = coc.window.showQuickPick(connectionNames, {
                title: "Select Connection to Create Binding for",
                placeHolder: "For which connection do you want to create project binding?"
            });
        }
        return targetConnection;
    }

    private computeItemLabel(serverType: ServerType, connection: SonarCloudConnection | SonarQubeConnection) {
        if (serverType === ServerType.SonarQube) {
            return connection.connectionId ? connection.connectionId : (connection as SonarQubeConnection).serverUrl;
        }
        return connection.connectionId ? connection.connectionId : (connection as SonarCloudConnection).organizationKey;
    }

    private computeConnectionId(connection: SonarQubeConnection | SonarCloudConnection) {
        return connection.connectionId ? connection.connectionId : DEFAULT_CONNECTION_ID;
    }

    async askUserBeforeAutoBinding() {
        return coc.window
            .showInformationMessage(CONFIGURE_BINDING_PROMPT_MESSAGE, BIND_ACTION, DONT_ASK_AGAIN_ACTION)
            .then(async (action) => {
                if (action === DONT_ASK_AGAIN_ACTION) {
                    this.workspaceState.update(DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_WS_FLAG, true);
                } else if (action === BIND_ACTION) {
                    const targetConnection = await this.getTargetConnectionForManualBinding();
                    await this.bindingService.createOrEditBinding(targetConnection.connectionId, targetConnection.contextValue);
                }
            });
    }

    private async promptToAutoBind(bindingSuggestions: BindingSuggestion[], unboundFolder: coc.WorkspaceFolder) {
        if (bindingSuggestions.length === 1) {
            const bestBindingSuggestion = bindingSuggestions[0];
            await this.promptToAutoBindSingleOption(bestBindingSuggestion, unboundFolder);
        } else if (bindingSuggestions.length > 1) {
            await this.promptToAutoBindMultiChoice(unboundFolder);
        } else {
            await this.promptToBindManually(unboundFolder);
        }
    }

    private async promptToBindManually(unboundFolder: coc.WorkspaceFolder) {
        coc.window
            .showInformationMessage(CONFIGURE_BINDING_MANUALLY_PROMPT_MESSAGE, BIND_ACTION, DONT_ASK_AGAIN_ACTION)
            .then(async (action) => {
                if (action === DONT_ASK_AGAIN_ACTION) {
                    this.workspaceState.update(DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_FOLDER_FLAG, [
                        ...this.getFoldersThatShouldNotBeAutoBound(),
                        unboundFolder.uri.toString()
                    ]);
                } else if (action === BIND_ACTION) {
                    const targetConnection = await this.getTargetConnectionForManualBinding();
                    await this.bindingService.createOrEditBinding(targetConnection.connectionId, targetConnection.contextValue);
                }
            });
    }

    private async promptToAutoBindSingleOption(bindingSuggestion: BindingSuggestion, unboundFolder: coc.WorkspaceFolder) {
        const commonMessage = `Do you want to bind folder '${unboundFolder.name}' to project '${bindingSuggestion.sonarProjectKey}'`;
        const message = this.isBindingSuggestionForSonarCloud(bindingSuggestion)
            ? `${commonMessage} of SonarQube Cloud organization '${bindingSuggestion.connectionId}'?`
            : `${commonMessage} of SonarQube Server '${bindingSuggestion.connectionId}'?`;

        const result = await coc.window.showInformationMessage(
            `${message}
      [Learn More](${SonarLintDocumentation.CONNECTED_MODE})`,
            BIND_ACTION,
            CHOOSE_MANUALLY_ACTION,
            DONT_ASK_AGAIN_ACTION
        );
        const bindingCreationMode = bindingSuggestion.isFromSharedConfiguration
            ? ExtendedServer.BindingCreationMode.IMPORTED
            : ExtendedServer.BindingCreationMode.AUTOMATIC;

        switch (result) {
            case BIND_ACTION:
                await this.bindingService.saveBinding(
                    bindingSuggestion.sonarProjectKey,
                    unboundFolder,
                    bindingCreationMode,
                    bindingSuggestion.connectionId
                );
                break;
            case CHOOSE_MANUALLY_ACTION: {
                const targetConnection = await this.getTargetConnectionForManualBinding();
                await this.bindingService.createOrEditBinding(targetConnection.connectionId, targetConnection.contextValue);
                break;
            }
            case DONT_ASK_AGAIN_ACTION:
                await this.workspaceState.update(DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_FOLDER_FLAG, [
                    ...this.getFoldersThatShouldNotBeAutoBound(),
                    unboundFolder.uri.toString()
                ]);
                break;
            default:
                // NOP
                break;
        }
    }

    private isBindingSuggestionForSonarCloud(bindingSuggestion: BindingSuggestion) {
        const sonarCloudConnections = this.settingsService.getSonarCloudConnections();
        return sonarCloudConnections.filter((sc) => bindingSuggestion.connectionId === sc.connectionId).length > 0;
    }

    private async promptToAutoBindMultiChoice(unboundFolder: coc.WorkspaceFolder) {
        const result = await coc.window.showInformationMessage(CONFIGURE_BINDING_PROMPT_MESSAGE, BIND_ACTION, DONT_ASK_AGAIN_ACTION);
        switch (result) {
            case BIND_ACTION: {
                const targetConnection = await this.getTargetConnectionForManualBinding();
                await this.bindingService.createOrEditBinding(targetConnection.connectionId, targetConnection.contextValue);
                break;
            }
            case DONT_ASK_AGAIN_ACTION:
                await this.workspaceState.update(DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_FOLDER_FLAG, [
                    ...this.getFoldersThatShouldNotBeAutoBound(),
                    unboundFolder.uri.toString()
                ]);
                break;
            default:
                // NOP
                break;
        }
    }

    onFile(folderUri: string, fileName: string, fullFileUri: coc.Uri) {
        if (folderUri && this.filesPerConfigScope.get(folderUri) === undefined) {
            this.filesPerConfigScope.set(folderUri, []);
        }
        this.filesPerConfigScope.get(folderUri)?.push({ fileName, filePath: fullFileUri.fsPath, content: undefined });
    }

    didRemoveWorkspaceFolder(workspaceFolderUri: coc.Uri) {
        this.filesPerConfigScope.set(workspaceFolderUri.toString(), []);
    }

    async listAutobindingFilesInFolder(params: ExtendedClient.FolderUriParams): Promise<ExtendedClient.ListFilesInScopeResponse> {
        const baseFolderUri = coc.Uri.parse(params.folderUri);
        await this.getContentOfAutobindingFiles(params.folderUri);
        const foundFiles: Array<ExtendedClient.FoundFileDto> = [
            ...(await this.listJsonFilesInDotSonarLint(baseFolderUri)),
            ...(this.filesPerConfigScope.get(baseFolderUri.toString()) || [])
        ];
        return { foundFiles };
    }

    private async getContentOfAutobindingFiles(folderUri: string) {
        for (const file of this.filesPerConfigScope.get(folderUri) || []) {
            if (file.fileName === AUTOSCAN_CONFIG_FILENAME || file.fileName === SONAR_SCANNER_CONFIG_FILENAME) {
                const fileUri = coc.Uri.file(file.filePath);
                file.content = await coc.workspace.readFile(fileUri.toString());
            }
        }
    }

    private async listJsonFilesInDotSonarLint(folderUri: coc.Uri) {
        const dotSonarLintUri = Path.join(folderUri.fsPath, ".sonarlint");
        try {
            // First check that the directory exists with `stat` to avoid errors logged by `readDirectory`
            if (!fse.statSync(dotSonarLintUri).isDirectory()) {
                return [];
            }
            const baseFiles: string[] = fse.readdirSync(dotSonarLintUri);
            const foundFiles: Array<ExtendedClient.FoundFileDto> = [];
            for (const name of baseFiles) {
                const fullFileUri = Path.join(dotSonarLintUri, name);

                if (fse.statSync(fullFileUri).isFile()) {
                    await this.readJsonFiles(name, fullFileUri, foundFiles);
                }
            }
            return foundFiles;
        } catch (error) {
            logToSonarLintOutput(`${(error as Error).message}`);
            return [];
        }
    }

    private async readJsonFiles(name: string, fullFileUri: string, foundFiles: Array<ExtendedClient.FoundFileDto>) {
        let content: string | undefined = undefined;
        if (name.endsWith(".json")) {
            content = fse.readFileSync(fullFileUri).toString();
        }
        foundFiles.push({ fileName: name, filePath: fullFileUri, content });
    }
}
