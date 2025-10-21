/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

"use strict";

import * as coc from "coc.nvim";
import { Memento } from "coc.nvim";
import { Commands } from "../util/commands";
import { ConnectionSettingsService, SonarCloudRegion } from "../settings/connectionsettings";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import { Connection, ServerType, WorkspaceFolderItem } from "./connections";
import { buildProjectOverviewBaseServerUrl, serverProjectsToQuickPickItems } from "../util/bindingUtils";
import { code2ProtocolConverter } from "../util/uri";
import { DEFAULT_CONNECTION_ID } from "../commons";
import { ExtendedClient, ExtendedServer } from "../lsp/protocol";
import { DONT_ASK_AGAIN_ACTION } from "../util/showMessage";
import { SharedConnectedModeSettingsService } from "./sharedConnectedModeSettingsService";
import OPEN_BROWSER = Commands.OPEN_BROWSER;

const SONARLINT_CATEGORY = "sonarlint";
const BINDING_SETTINGS = "connectedMode.project";
const OPEN_FOLDER_ACTION = "Open Folder";
const BIND_MANUALLY_ACTION = "Bind Manually";
export const DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_FOLDER_FLAG = "doNotAskAboutAutoBindingForFolder";

export class BindingService {
    private static _instance: BindingService;

    static init(
        languageClient: SonarLintExtendedLanguageClient,
        workspaceState: coc.Memento,
        settingsService: ConnectionSettingsService,
        sharedConnectedModeSettingsService: SharedConnectedModeSettingsService
    ): void {
        BindingService._instance = new BindingService(languageClient, workspaceState, settingsService, sharedConnectedModeSettingsService);
    }

    constructor(
        private readonly languageClient: SonarLintExtendedLanguageClient,
        private readonly workspaceState: coc.Memento,
        private readonly settingsService: ConnectionSettingsService,
        private readonly sharedConnectedModeSettingsService: SharedConnectedModeSettingsService
    ) {}

    static get instance(): BindingService {
        return BindingService._instance;
    }

    async bindManuallyAction(workspaceFolder: coc.WorkspaceFolder) {
        const existingSettings = coc.workspace.getConfiguration(SONARLINT_CATEGORY, workspaceFolder).get<ProjectBinding>(BINDING_SETTINGS);
        if (existingSettings?.projectKey === undefined) {
            await coc.workspace
                .getConfiguration(SONARLINT_CATEGORY, workspaceFolder)
                .update(BINDING_SETTINGS, { connectionId: "", projectKey: "" });
            await this.languageClient.didCreateBinding(ExtendedServer.BindingCreationMode.MANUAL);
        }
        coc.commands.executeCommand("workbench.action.openFolderSettingsFile");
    }

    async deleteBindingWithConfirmation(binding: WorkspaceFolderItem): Promise<void> {
        const deleteAction = "Delete";
        const confirm = await coc.window.showWarningMessage(
            `Are you sure you want to delete ${binding.serverType} project binding '${binding.name}'?`,
            deleteAction
        );
        if (confirm !== deleteAction) {
            return Promise.resolve(undefined);
        }
        return this.deleteBinding(binding);
    }

    async deleteBinding(workspaceFolderItem: WorkspaceFolderItem | BoundFolder): Promise<void> {
        const folder = workspaceFolderItem instanceof WorkspaceFolderItem ? workspaceFolderItem.uri : workspaceFolderItem.folder;
        const config = coc.workspace.getConfiguration(SONARLINT_CATEGORY, folder);
        return config.update(BINDING_SETTINGS, undefined, coc.ConfigurationTarget.WorkspaceFolder);
    }

    async deleteBindingsForConnection(connection: Connection | string) {
        const connectionId = typeof connection === "string" ? connection : connection.id || DEFAULT_CONNECTION_ID;
        const allBindings = this.getAllBindings();
        const bindingsForConnection: Map<string, BoundFolder[]> | undefined = allBindings.get(connectionId);
        if (bindingsForConnection) {
            for (const folders of bindingsForConnection.values()) {
                await Promise.all(folders.map((f) => this.deleteBinding(f)));
            }
        }
    }

    getAllBindings(): Map<string, Map<string, BoundFolder[]>> {
        const bindingsPerConnectionId = new Map<string, Map<string, BoundFolder[]>>();
        for (const folder of coc.workspace.workspaceFolders || []) {
            const config = coc.workspace.getConfiguration(SONARLINT_CATEGORY, folder.uri);
            const binding = config.get<ProjectBinding>(BINDING_SETTINGS);
            const projectKey = binding?.projectKey;
            if (projectKey) {
                const connectionId = binding.connectionId || binding.serverId || DEFAULT_CONNECTION_ID;
                if (!bindingsPerConnectionId.has(connectionId)) {
                    bindingsPerConnectionId.set(connectionId, new Map<string, BoundFolder[]>());
                }
                const connectionBindingsPerProjectKey = bindingsPerConnectionId.get(connectionId);
                if (!connectionBindingsPerProjectKey?.has(projectKey)) {
                    connectionBindingsPerProjectKey?.set(projectKey, []);
                }
                connectionBindingsPerProjectKey?.get(projectKey)?.push({ folder, binding });
            }
        }
        return bindingsPerConnectionId;
    }

    bindingStatePerFolder(): Map<coc.Uri, boolean> {
        const bindingStatePerFolder = new Map<coc.Uri, boolean>();
        for (const folder of coc.workspace.workspaceFolders || []) {
            const config = coc.workspace.getConfiguration(SONARLINT_CATEGORY, folder.uri);
            const binding = config.get<ProjectBinding>(BINDING_SETTINGS);
            bindingStatePerFolder.set(coc.Uri.parse(folder.uri), binding?.projectKey !== undefined);
        }
        return bindingStatePerFolder;
    }

    async assistBinding(params: ExtendedClient.AssistBindingParams) {
        const workspaceFolders = coc.workspace.workspaceFolders;
        const selectedWorkspaceFolderName = await this.showFolderSelectionQuickPickOrReturnDefaultSelection(workspaceFolders);
        const workspaceFolder = workspaceFolders.find((f) => f.name === selectedWorkspaceFolderName);

        await coc.workspace
            .getConfiguration(SONARLINT_CATEGORY, workspaceFolder)
            .update(BINDING_SETTINGS, { connectionId: params.connectionId, projectKey: params.projectKey });
        await this.languageClient.didCreateBinding(
            params.isFromSharedConfiguration ? ExtendedServer.BindingCreationMode.IMPORTED : ExtendedServer.BindingCreationMode.AUTOMATIC
        );

        return { configurationScopeId: workspaceFolder?.uri.toString() };
    }

    async createOrEditBinding(connectionId: string, contextValue: string, workspaceFolder?: coc.WorkspaceFolder, serverType?: ServerType) {
        if (!this.isRelatedConnectionValid(connectionId)) {
            coc.window
                .showErrorMessage(`Connection '${connectionId}' is not working. You cannot create a binding for a non-working connection.
      Please fix the connection and try again.`);
            return;
        }
        const workspaceFolders = coc.workspace.workspaceFolders;
        if (!workspaceFolders) {
            const action = await coc.window.showWarningMessage(
                "No folders to pick, please open a workspace or folder first",
                OPEN_FOLDER_ACTION
            );
            if (action === OPEN_FOLDER_ACTION) {
                coc.commands.executeCommand("vscode.open");
            }
            return;
        }

        if (!serverType) {
            serverType = contextValue === "sonarqubeConnection" ? ServerType.SonarQube : ServerType.SonarCloud;
        }
        let selectedFolderName: string | undefined;
        if (workspaceFolder) {
            selectedFolderName = workspaceFolder.name;
        } else {
            selectedFolderName = await this.showFolderSelectionQuickPickOrReturnDefaultSelection(workspaceFolders);
            workspaceFolder = workspaceFolders.find((f) => f.name === selectedFolderName);
        }
        await this.pickRemoteProjectToBind(connectionId, workspaceFolder as coc.WorkspaceFolder, serverType, selectedFolderName);
    }

    isRelatedConnectionValid(connectionId: string): boolean {
        return this.settingsService.getStatusForConnection(connectionId)?.success ?? false;
    }

    async getBaseServerUrl(connectionId: string, serverType: ServerType): Promise<string> {
        let serverUrlOrOrganizationKey: string | undefined;
        let region: SonarCloudRegion | undefined = undefined;
        if (serverType === ServerType.SonarQube) {
            serverUrlOrOrganizationKey = (await this.settingsService.loadSonarQubeConnection(connectionId))?.serverUrl;
        } else {
            const sonarCloudConnection = await this.settingsService.loadSonarCloudConnection(connectionId);
            serverUrlOrOrganizationKey = sonarCloudConnection?.organizationKey;
            region = sonarCloudConnection?.region;
        }
        return buildProjectOverviewBaseServerUrl(serverType, serverUrlOrOrganizationKey as string, region);
    }

    private async pickRemoteProjectToBind(
        connectionId: string,
        workspaceFolder: coc.WorkspaceFolder,
        serverType: ServerType,
        selectedFolderName: string | undefined
    ) {
        if (!workspaceFolder) {
            return;
        }
        const suggestedProjects: coc.QuickPickItem[] = await this.getSuggestedItems(connectionId, workspaceFolder, serverType);
        const remoteProjects: coc.QuickPickItem[] = await this.getRemoteProjectsItems(connectionId, workspaceFolder, serverType);
        const remoteProjectsItems: coc.QuickPickItem[] = this.deduplicateQuickPickItems(suggestedProjects, remoteProjects);
        const allProjectsGroup: coc.QuickPickItem = { label: "All Projects" };
        const suggestedProjectsGroup: coc.QuickPickItem = { label: "Suggested Projects" };
        if (remoteProjects) {
            const remoteProjectsQuickPick = await coc.window.showQuickPick(
                [suggestedProjectsGroup, ...suggestedProjects, allProjectsGroup, ...remoteProjectsItems],
                {
                    title: `Select ${serverType} Project to Bind with '${selectedFolderName}/'`,
                    placeholder: `Select the remote project you want to bind with '${selectedFolderName}/' folder`,
                    canPickMany: false
                }
            );

            if (!remoteProjectsQuickPick?.description) {
                await coc.window.showWarningMessage(`Must pick at least one project form the list`);
                return;
            }

            this.saveBinding(remoteProjectsQuickPick.description, workspaceFolder, ExtendedServer.BindingCreationMode.MANUAL, connectionId);
        }
    }

    private deduplicateQuickPickItems(suggestedProjects: coc.QuickPickItem[], remoteProjects: coc.QuickPickItem[]) {
        suggestedProjects.forEach((sp) => {
            remoteProjects = remoteProjects.filter((rp) => rp.description !== sp.description);
        });
        return remoteProjects;
    }

    private async getSuggestedItems(
        connectionId: string,
        workspaceFolder: coc.WorkspaceFolder,
        serverType: ServerType
    ): Promise<coc.QuickPickItem[]> {
        const configScopeId = code2ProtocolConverter(coc.Uri.parse(workspaceFolder.uri));
        connectionId = connectionId || DEFAULT_CONNECTION_ID;
        const suggestedBinding = await this.languageClient.getSuggestedBinding(configScopeId, connectionId);

        if (suggestedBinding?.suggestions?.[configScopeId]) {
            return serverProjectsToQuickPickItems(suggestedBinding.suggestions[configScopeId], serverType);
        }
        return [];
    }

    async showFolderSelectionQuickPickOrReturnDefaultSelection(workspaceFolders: readonly coc.WorkspaceFolder[]) {
        return workspaceFolders.length === 1
            ? workspaceFolders[0].name
            : coc.window.showQuickPick(
                  workspaceFolders.map((f) => f.name),
                  {
                      title: "Select Folder to Bind",
                      placeHolder: "Select the workspace folder you want to create binding for"
                  }
              );
    }

    async saveBinding(
        projectKey: string,
        workspaceFolder: coc.WorkspaceFolder,
        creationMode: ExtendedServer.BindingCreationMode,
        connectionId?: string
    ) {
        connectionId = connectionId || DEFAULT_CONNECTION_ID;
        await coc.workspace.getConfiguration(SONARLINT_CATEGORY, workspaceFolder).update(BINDING_SETTINGS, { connectionId, projectKey });
        await this.languageClient.didCreateBinding(creationMode);

        coc.window.showInformationMessage(`Workspace folder '${workspaceFolder.name}/' has been bound with project '${projectKey}'`);

        if (creationMode === ExtendedServer.BindingCreationMode.MANUAL) {
            this.proposeSharingConfig(projectKey, workspaceFolder);
        }
    }

    private async proposeSharingConfig(_projectKey: string, workspaceFolder: coc.WorkspaceFolder) {
        const SHARE_CONFIGURATION_ACTION = "Share configuration";
        const LEARN_MORE_ACTION = "Learn more";
        const OK_ACTION = "Ok";

        coc.window
            .showInformationMessage(
                `Do you want to share this new SonarQube Connected Mode configuration?
    A configuration file will be created in this working directory. This will allow your team to reuse the binding configuration`,
                OK_ACTION,
                SHARE_CONFIGURATION_ACTION,
                LEARN_MORE_ACTION
            )
            .then((selection) => {
                if (selection === SHARE_CONFIGURATION_ACTION) {
                    this.sharedConnectedModeSettingsService.createSharedConnectedModeSettingsFile(workspaceFolder);
                } else if (selection === LEARN_MORE_ACTION) {
                    coc.commands.executeCommand(
                        OPEN_BROWSER,
                        coc.Uri.parse(
                            "https://docs.sonarsource.com/sonarqube-for-vs-code/team-features/connected-mode-setup/#reuse-the-binding-configuration"
                        )
                    );
                }
            });
    }

    async getRemoteProjects(connectionId: string) {
        return this.languageClient.getRemoteProjectsForConnection(connectionId);
    }

    async getRemoteProjectsItems(connectionId: string, workspaceFolder: coc.WorkspaceFolder, serverType: ServerType) {
        const getRemoteProjectsParam = connectionId || DEFAULT_CONNECTION_ID;
        const itemsList: coc.QuickPickItem[] = [];

        try {
            let remoteProjects: any = await this.getRemoteProjects(getRemoteProjectsParam);
            if (!(remoteProjects instanceof Map)) {
                remoteProjects = new Map(Object.entries(remoteProjects));
            }

            if (remoteProjects.size === 0) {
                coc.window.showWarningMessage("No remote projects to display.", BIND_MANUALLY_ACTION).then(async (action) => {
                    if (action === BIND_MANUALLY_ACTION) {
                        this.bindManuallyAction(workspaceFolder);
                    }
                });
            }

            remoteProjects.forEach((v: any, k: any) => {
                itemsList.push({
                    label: v,
                    description: k
                });
            });
        } catch {
            coc.window.showErrorMessage("Request Failed: Could not get the list of remote projects." + " Please check the connection.");
        }

        itemsList.sort((i1, i2) => i1.label.localeCompare(i2.label, "en"));
        return itemsList;
    }

    shouldBeAutoBound(workspaceFolder: coc.WorkspaceFolder) {
        const foldersToBeIgnored = this.workspaceState.get<string[]>(DO_NOT_ASK_ABOUT_AUTO_BINDING_FOR_FOLDER_FLAG, []);
        return !this.isBound(workspaceFolder) && !foldersToBeIgnored.includes(workspaceFolder.uri.toString());
    }

    isBound(workspaceFolder: coc.WorkspaceFolder) {
        const config = coc.workspace.getConfiguration(SONARLINT_CATEGORY, workspaceFolder.uri);
        const binding = config.get<ProjectBinding>(BINDING_SETTINGS);
        return !!binding?.projectKey;
    }

    async removeBindingsForRemovedConnections(connectionIds: string[]) {
        for (const connectionId of connectionIds) {
            await this.deleteBindingsForConnection(connectionId);
        }
    }
}

export function showSoonUnsupportedVersionMessage(params: ExtendedClient.ShowSoonUnsupportedVersionMessageParams, workspaceState: Memento) {
    const hasBeenShown = workspaceState.get<boolean>(params.doNotShowAgainId, false);
    if (!hasBeenShown) {
        coc.window.showWarningMessage(params.text, DONT_ASK_AGAIN_ACTION).then(async (action) => {
            if (action === DONT_ASK_AGAIN_ACTION) {
                workspaceState.update(params.doNotShowAgainId, true);
            }
        });
    }
}

export interface ProjectBinding {
    projectKey: string;
    serverId?: string;
    connectionId?: string;
}

export interface BoundFolder {
    folder: coc.WorkspaceFolder;
    binding: ProjectBinding;
}

export interface ServerProject {
    key: string;
    name: string;
}
