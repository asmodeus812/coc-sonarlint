/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as coc from 'coc.nvim';
import {SonarLintExtendedLanguageClient} from '../lsp/client';
import {ConnectionCheckResult} from '../lsp/protocol';

const SONARLINT_CATEGORY = 'sonarlint';
const CONNECTIONS_SECTION = 'connectedMode.connections';
const SONARQUBE = 'sonarqube';
const SONARCLOUD = 'sonarcloud';
const SONARQUBE_CONNECTIONS_CATEGORY = `${SONARLINT_CATEGORY}.${CONNECTIONS_SECTION}.${SONARQUBE}`;
const SONARCLOUD_CONNECTIONS_CATEGORY = `${SONARLINT_CATEGORY}.${CONNECTIONS_SECTION}.${SONARCLOUD}`;

export class ConnectionSettingsService {
    private readonly secretStorage: Map<string, string | undefined> = new Map<string, string | undefined>()
    private readonly connectionCheckResults: Map<string, ConnectionCheckResult>;

    constructor(
        private readonly client: SonarLintExtendedLanguageClient
    ) {
        this.connectionCheckResults = new Map<string, ConnectionCheckResult>();

        const qubeConnections = this.getSonarQubeConnections();
        qubeConnections.forEach(connection => {
            this.secretStorage.set(connection.serverUrl, connection.token);
        });
        const cloudConnections = this.getSonarCloudConnections()
        cloudConnections.forEach(connection => {
            this.secretStorage.set(connection.organizationKey, connection.token);
        })
    }

    async storeUpdatedConnectionToken(connection: SonarQubeConnection | SonarCloudConnection, token: string | undefined) {
        const tokenStorageKey = getTokenStorageKey(connection);
        const existingToken = this.secretStorage.get(tokenStorageKey);
        if (token && (!existingToken || existingToken !== token)) {
            await this.storeServerToken(tokenStorageKey, token);
            return true;
        }
        return false;
    }

    async storeServerToken(serverUrlOrOrganizationKey: string, token: string): Promise<void> {
        if (token) {
            this.secretStorage.set(serverUrlOrOrganizationKey, token);
        }
    }

    async getServerToken(serverUrlOrOrganizationKey: string): Promise<string | undefined> {
        return this.secretStorage.get(serverUrlOrOrganizationKey);
    }

    async hasTokenForConnection(connection: SonarQubeConnection | SonarCloudConnection) {
        return this.hasTokenForServer(getTokenStorageKey(connection));
    }

    async hasTokenForServer(serverUrlOrOrganizationKey: string): Promise<boolean> {
        try {
            const serverToken = await this.getServerToken(serverUrlOrOrganizationKey);
            return serverToken !== undefined;
        } catch (errorWhileFetchingToken) {
            return false;
        }
    }

    async deleteTokenForConnection(connection: SonarQubeConnection | SonarCloudConnection): Promise<void> {
        return this.deleteTokenForServer(getTokenStorageKey(connection));
    }

    async deleteTokenForServer(serverUrlOrOrganizationKey: string): Promise<void> {
        return new Promise(() => {
            this.secretStorage.delete(serverUrlOrOrganizationKey);
        })
    }

    async addSonarQubeConnection(connection: SonarQubeConnection) {
        const connections = this.getSonarQubeConnections();
        const newConnection: SonarQubeConnection = {serverUrl: connection.serverUrl};
        if (connection.connectionId !== undefined) {
            newConnection.connectionId = connection.connectionId;
        }
        if (connection.disableNotifications) {
            newConnection.disableNotifications = true;
        }
        await this.storeUpdatedConnectionToken(connection, connection.token);
        connections.push(newConnection);
        await coc.workspace
            .getConfiguration()
            .update(SONARQUBE_CONNECTIONS_CATEGORY, connections);

        return newConnection.connectionId;
    }

    async updateSonarQubeConnection(connection: SonarQubeConnection) {
        const connections = this.getSonarQubeConnections();
        const connectionToUpdate = connections.find(c => c.connectionId === connection.connectionId);
        if (!connectionToUpdate) {
            throw new Error(`Could not find connection '${connection.connectionId}' to update`);
        }
        connectionToUpdate.serverUrl = connection.serverUrl;
        if (connection.disableNotifications) {
            connectionToUpdate.disableNotifications = true;
        } else {
            delete connectionToUpdate.disableNotifications;
        }
        const didUpdateToken = await this.storeUpdatedConnectionToken(connection, connection.token);
        if (didUpdateToken && connection.connectionId && connection.token) {
            await this.client.onTokenUpdate(connection.connectionId, connection.token);
        }
        delete connectionToUpdate.token;
        this.setSonarQubeConnections(connections)
    }

    getSonarQubeConnections(): SonarQubeConnection[] {
        return coc.workspace
            .getConfiguration(SONARLINT_CATEGORY)
            .get<SonarQubeConnection[]>(`${CONNECTIONS_SECTION}.${SONARQUBE}`) || [];
    }

    setSonarQubeConnections(sqConnections: SonarQubeConnection[]) {
        coc.workspace
            .getConfiguration()
            .update(SONARQUBE_CONNECTIONS_CATEGORY, sqConnections, coc.ConfigurationTarget.Global);
    }

    getSonarCloudConnections(): SonarCloudConnection[] {
        return coc.workspace
            .getConfiguration(SONARLINT_CATEGORY)
            .get<SonarCloudConnection[]>(`${CONNECTIONS_SECTION}.${SONARCLOUD}`) || [];
    }

    setSonarCloudConnections(scConnections: SonarCloudConnection[]) {
        coc.workspace
            .getConfiguration()
            .update(SONARCLOUD_CONNECTIONS_CATEGORY, scConnections);
    }

    async addSonarCloudConnection(connection: SonarCloudConnection) {
        const connections = this.getSonarCloudConnections();
        const newConnection: SonarCloudConnection = {organizationKey: connection.organizationKey};
        if (connection.connectionId !== undefined) {
            newConnection.connectionId = connection.connectionId;
        }
        if (connection.disableNotifications) {
            newConnection.disableNotifications = true;
        }
        await this.storeUpdatedConnectionToken(connection, connection.token);
        connections.push(newConnection);
    }

    async updateSonarCloudConnection(connection: SonarCloudConnection) {
        const connections = this.getSonarCloudConnections();
        const connectionToUpdate = connections.find(c => c.connectionId === connection.connectionId);
        if (!connectionToUpdate) {
            throw new Error(`Could not find connection '${connection.connectionId}' to update`);
        }
        connectionToUpdate.organizationKey = connection.organizationKey;
        if (connection.disableNotifications) {
            connectionToUpdate.disableNotifications = true;
        } else {
            delete connectionToUpdate.disableNotifications;
        }
        const didUpdateToken = await this.storeUpdatedConnectionToken(connection, connection.token);
        if (didUpdateToken && connection.connectionId && connection.token) {
            await this.client.onTokenUpdate(connection.connectionId, connection.token);
        }
        delete connectionToUpdate.token;
        coc.workspace
            .getConfiguration()
            .update(SONARCLOUD_CONNECTIONS_CATEGORY, connections, coc.ConfigurationTarget.Global);
    }

    async addTokensFromSettingsToSecureStorage(
        sqConnections: SonarQubeConnection[],
        scConnections: SonarCloudConnection[]
    ) {
        await Promise.all(
            [...sqConnections, ...scConnections].map(async c => {
                if (c.token !== undefined && !(await this.hasTokenForConnection(c))) {
                    await this.storeUpdatedConnectionToken(c, c.token);
                    c.token = undefined;
                }
            })
        );
        await updateConfigIfNotEmpty(sqConnections, SONARQUBE_CONNECTIONS_CATEGORY);
        await updateConfigIfNotEmpty(scConnections, SONARCLOUD_CONNECTIONS_CATEGORY);
    }

    async loadSonarQubeConnection(connectionId: string) {
        const allSonarQubeConnections = this.getSonarQubeConnections();
        const loadedConnection = allSonarQubeConnections.find(c => c.connectionId === connectionId);
        if (loadedConnection) {
            loadedConnection.token = await this.getServerToken(loadedConnection.serverUrl);
        }
        return loadedConnection;
    }

    async loadSonarCloudConnection(connectionId: string) {
        const allSonarCloudConnections = this.getSonarCloudConnections();
        const loadedConnection = allSonarCloudConnections.find(c => c.connectionId === connectionId);
        if (loadedConnection) {
            loadedConnection.token = await this.getServerToken(loadedConnection.organizationKey);
        }
        return loadedConnection;
    }

    async generateToken(baseServerUrl: string) {
        const {token} = await this.client.generateToken(baseServerUrl);
        if (!token) {
            coc.window.showWarningMessage(`Could not automatically generate server token for generation params: ${baseServerUrl}`);
        }
        return token;
    }

    async checkNewConnection(token: string, serverOrOrganization: string, isSonarQube: boolean) {
        return this.client.checkNewConnection(token, serverOrOrganization, isSonarQube);
    }

    reportConnectionCheckResult(connectionCheckResult: ConnectionCheckResult) {
        this.connectionCheckResults.set(connectionCheckResult.connectionId, connectionCheckResult);
    }

    getStatusForConnection(connectionId: string) {
        return this.connectionCheckResults.get(connectionId);
    }
}

export interface BaseConnection {
    token?: string;
    connectionId?: string;
    disableNotifications?: boolean;
    connectionCheckResult?: Promise<ConnectionCheckResult>;
    projectKey?: string;
    isFromSharedConfiguration?: boolean;
    folderUri?: string;
}

export interface SonarQubeConnection extends BaseConnection {
    serverUrl: string;
}

export interface SonarCloudConnection extends BaseConnection {
    organizationKey: string;
}

export function isSonarQubeConnection(connection: BaseConnection): connection is SonarQubeConnection {
    return (connection as SonarQubeConnection).serverUrl !== undefined;
}

function getTokenStorageKey(connection: SonarQubeConnection | SonarCloudConnection) {
    return isSonarQubeConnection(connection) ? connection.serverUrl : connection.organizationKey;
}

async function updateConfigIfNotEmpty(connections: BaseConnection[], configCategory: string) {
    if (connections.length > 0) {
        await coc.workspace.getConfiguration().update(configCategory, connections);
    }
}
