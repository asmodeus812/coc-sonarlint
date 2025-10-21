/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { DEFAULT_CONNECTION_ID } from "../commons";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import { ConnectionCheckResult } from "../lsp/protocol";
import { BaseConnection, ConnectionSettingsService, SonarCloudConnection } from "../settings/connectionsettings";
import { shouldShowRegionSelection } from "../settings/settings";
import { ExtendedTreeItem } from "../util/types";
import { BindingService } from "./binding";
import { logToSonarLintOutput } from "../util/logging";

type ConnectionStatus = "ok" | "notok" | "loading";

export class WorkspaceFolderItem extends ExtendedTreeItem {
    constructor(
        public readonly name: string,
        public readonly uri: coc.WorkspaceFolder,
        public readonly connectionId: string,
        public readonly serverType: ServerType
    ) {
        super(name, coc.TreeItemCollapsibleState.None);
        this.contextValue = "workspaceFolder";
        this.command = {
            command: "SonarLint.ShowAllInfoForConnection",
            title: "Show connection actions",
            arguments: [this]
        };
    }
}

export class RemoteProject extends ExtendedTreeItem {
    constructor(
        public readonly connectionId: string,
        public readonly key: string,
        public readonly serverType: ServerType,
        public readonly name?: string
    ) {
        super(name || "<project not found>", coc.TreeItemCollapsibleState.Expanded);
        this.description = key;
        this.contextValue = "remoteProject";
        this.command = {
            command: "SonarLint.ShowAllInfoForConnection",
            title: "Show connection actions",
            arguments: [this]
        };
    }
}

export class Connection extends ExtendedTreeItem {
    collapsibleState = coc.TreeItemCollapsibleState.Expanded;
    constructor(
        public readonly id: string,
        public readonly label: string,
        public readonly contextValue: "sonarqubeConnection" | "sonarcloudConnection",
        public status: ConnectionStatus,
        public connection: BaseConnection
    ) {
        super(label, coc.TreeItemCollapsibleState.Expanded);
        this.description = `(${status})`;
        this.command = {
            command: "SonarLint.ShowAllInfoForConnection",
            title: "Show connection actions",
            arguments: [this]
        };
    }
}

export type ConnectionType = "__sonarqube__" | "__sonarcloud__";

export class ConnectionGroup extends ExtendedTreeItem {
    constructor(
        public readonly id: ConnectionType,
        public readonly label: "SonarQube Server" | "SonarQube Cloud",
        public readonly contextValue: "sonarQubeGroup" | "sonarCloudGroup"
    ) {
        super(label, coc.TreeItemCollapsibleState.Expanded);
    }
}

export type ConnectionsNode = Connection | ConnectionGroup | RemoteProject | WorkspaceFolderItem;

export class AllConnectionsTreeDataProvider implements coc.TreeDataProvider<ConnectionsNode> {
    private readonly _onDidChangeTreeData = new coc.Emitter<Connection | undefined>();
    readonly onDidChangeTreeData: coc.Event<ConnectionsNode | undefined> = this._onDidChangeTreeData.event;
    private allConnections = { __sonarqube__: Array.from<Connection>([]), __sonarcloud__: Array.from<Connection>([]) };

    constructor(private readonly client: SonarLintExtendedLanguageClient) {}

    async getConnections(type: ConnectionType): Promise<Connection[]> {
        const contextValue = type === "__sonarqube__" ? "sonarqubeConnection" : "sonarcloudConnection";
        const labelKey = "connectionId";
        const alternativeLabelKey = type === "__sonarqube__" ? "serverUrl" : "organizationKey";

        const connectionsFromSettings: BaseConnection[] =
            type === "__sonarqube__"
                ? ConnectionSettingsService.instance.getSonarQubeConnections()
                : ConnectionSettingsService.instance.getSonarCloudConnections();
        const connections = await Promise.all(
            connectionsFromSettings.map(async (c) => {
                // Display the region prefix in case user is in dogfooding,
                // has more than 1 SonarQube Cloud connections, and the region is set
                const regionPrefix =
                    shouldShowRegionSelection() &&
                    type !== "__sonarqube__" &&
                    connectionsFromSettings.length > 1 &&
                    (c as SonarCloudConnection).region
                        ? `[${(c as SonarCloudConnection).region}] `
                        : "";
                const label = c[labelKey] ? c[labelKey] : c[alternativeLabelKey];
                let status: ConnectionStatus = "loading";
                const connectionId: string = c.connectionId ? c.connectionId : DEFAULT_CONNECTION_ID;
                try {
                    const connectionCheckResult = ConnectionSettingsService.instance.getStatusForConnection(connectionId);
                    if (connectionCheckResult?.success) {
                        status = "ok";
                    } else if (connectionCheckResult?.reason && !/unknown/.test(connectionCheckResult.reason)) {
                        status = "notok";
                    }
                } catch (e) {
                    logToSonarLintOutput(`Unable to obtain connection with id ${connectionId} due to ${(e as Error).message}`);
                }
                return new Connection(c.connectionId as string, regionPrefix.concat(label), contextValue, status, c);
            })
        );

        this.allConnections[type] = connections;
        return connections;
    }

    async checkConnection(connectionId: string) {
        return this.client.checkConnection(connectionId);
    }

    refresh(connection?: Connection) {
        if (connection) {
            this._onDidChangeTreeData.fire(connection);
        } else {
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    getTreeItem(element: Connection): ExtendedTreeItem {
        return element;
    }

    async getChildren(element?: ConnectionsNode): Promise<ConnectionsNode[]> {
        if (!element) {
            return this.getInitialState();
        } else if (element.contextValue === "sonarQubeGroup") {
            return this.getConnections("__sonarqube__");
        } else if (element.contextValue === "sonarCloudGroup") {
            return this.getConnections("__sonarcloud__");
        } else if (element.contextValue === "sonarqubeConnection" || element.contextValue === "sonarcloudConnection") {
            const connection = element as Connection;
            const serverType = element.contextValue === "sonarqubeConnection" ? ServerType.SonarQube : ServerType.SonarCloud;
            return this.getBoundProjects(connection.id, serverType);
        } else if (element.contextValue === "remoteProject") {
            const project = element as RemoteProject;
            return this.getWorkspaceFoldersBoundTo(project.connectionId, project.key, project.serverType);
        }
        return [];
    }

    async getParent(element: ConnectionsNode): Promise<ConnectionsNode | undefined> {
        if (element.contextValue === "sonarqubeConnection") {
            return this.getInitialState()[0];
        } else if (element.contextValue === "sonarcloudConnection") {
            return this.getInitialState()[1];
        }
    }

    async getBoundProjects(connectionId: string, serverType: ServerType) {
        const boundProjects = BindingService.instance.getAllBindings().get(connectionId || DEFAULT_CONNECTION_ID);
        if (!boundProjects) {
            return [];
        }
        const allKeys = [...boundProjects.keys()];
        const keysToNames: any = await this.client.getRemoteProjectNamesByKeys(connectionId || DEFAULT_CONNECTION_ID, allKeys);
        return allKeys.map((k) => new RemoteProject(connectionId, k, serverType, keysToNames[k]));
    }

    getWorkspaceFoldersBoundTo(connectionId: string, projectKey: string, serverType: ServerType) {
        const boundProjects = BindingService.instance.getAllBindings().get(connectionId || DEFAULT_CONNECTION_ID);
        if (!boundProjects) {
            return [];
        }
        const boundFolders = boundProjects.get(projectKey);
        if (!boundFolders) {
            return [];
        }
        return boundFolders.map((f) => new WorkspaceFolderItem(f.folder.name, f.folder, connectionId, serverType));
    }

    getInitialState(): ConnectionGroup[] {
        const sqConnections = ConnectionSettingsService.instance.getSonarQubeConnections();
        const scConnections = ConnectionSettingsService.instance.getSonarCloudConnections();
        const result: ConnectionGroup[] = [];

        if (sqConnections.length > 0) {
            result.push(new ConnectionGroup("__sonarqube__", "SonarQube Server", "sonarQubeGroup"));
        }

        if (scConnections.length > 0) {
            result.push(new ConnectionGroup("__sonarcloud__", "SonarQube Cloud", "sonarCloudGroup"));
        }

        return result;
    }

    reportConnectionCheckResult(checkResult: ConnectionCheckResult) {
        const allConnections = [...this.allConnections.__sonarqube__, ...this.allConnections.__sonarcloud__];
        const connectionToUpdate = allConnections.find((c) => c.id === checkResult.connectionId);
        if (connectionToUpdate) {
            connectionToUpdate.status = checkResult.success ? "ok" : "notok";
            this.refresh(connectionToUpdate);
        }
    }
}

export enum ServerType {
    SonarQube = "SonarQube Server",
    SonarCloud = "SonarQube Cloud"
}
