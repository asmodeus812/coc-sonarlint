/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";

import { AutomaticConnectionSetupCancellationError } from "./automaticConnectionCancellationError";
import { ExtendedClient } from "../lsp/protocol";
import {
    ConnectionSettingsService,
    getTokenStorageKey,
    SonarCloudConnection,
    SonarCloudRegion,
    SonarQubeConnection
} from "../settings/connectionsettings";
import { Commands } from "../util/commands";
import { sonarCloudRegionToLabel } from "../util/util";

export function assistCreatingConnection(context: coc.ExtensionContext) {
    return async (assistCreatingConnectionParams: ExtendedClient.AssistCreatingConnectionParams) => {
        let newConnectionId: string | undefined;
        try {
            newConnectionId = await confirmConnectionDetailsAndSave(context)(
                assistCreatingConnectionParams.isSonarCloud,
                assistCreatingConnectionParams.serverUrlOrOrganisationKey,
                assistCreatingConnectionParams.token,
                sonarCloudRegionToLabel(assistCreatingConnectionParams.region as number)
            );
        } catch (error) {
            if (error instanceof AutomaticConnectionSetupCancellationError) {
                return null;
            }
        }
        return { newConnectionId };
    };
}

interface ConnectionConfirmationResponse {
    confirmed: boolean;
    cancelled: boolean;
}

async function confirmConnection(
    isSonarCloud: boolean,
    serverUrlOrOrganizationKey: string,
    token: string
): Promise<ConnectionConfirmationResponse> {
    const connectionType = isSonarCloud ? "SonarQube Cloud organization" : "SonarQube Server instance";
    let manualConnectionMessage = `Connecting Sonarlint to ${isSonarCloud ? "SonarQube Cloud" : "SonarQube Server"} will enable issues to be opened directly in your IDE. It will also allow you to apply the same code quality and security standards as your team, analyze more languages, detect more issues, receive notifications about the quality gate status, and more.
      \nEnsure that the requesting ${isSonarCloud ? "organization" : "server URL"} '${serverUrlOrOrganizationKey}' matches your ${connectionType}.`;

    if (!isSonarCloud) {
        manualConnectionMessage += ` Letting Sonarlint connect to an untrusted SonarQube Server instance is potentially dangerous. If you don't trust this server, we recommend canceling this action and manually setting up Connected Mode.`;
    }

    const automaticConnectionMessage = `${manualConnectionMessage}
      \nA token will be automatically generated to allow access to your ${connectionType}.`;

    const yesOption = `Connect to this ${connectionType}}`;
    const cancelOption = `Do not connect to ${connectionType}}`;
    const result = await coc.window.showWarningMessage(
        `Do you trust this ${connectionType}? ${token ? automaticConnectionMessage : manualConnectionMessage}`,
        yesOption,
        cancelOption
    );
    return {
        confirmed: result === yesOption,
        cancelled: result === undefined
    };
}

export function confirmConnectionDetailsAndSave(context: coc.ExtensionContext) {
    return async (isSonarCloud: boolean, serverUrlOrOrganizationKey: string, token: string, region: SonarCloudRegion) => {
        const reply = await confirmConnection(isSonarCloud, serverUrlOrOrganizationKey, token);
        if (reply.confirmed) {
            if (isSonarCloud) {
                const connection: SonarCloudConnection = {
                    connectionId: serverUrlOrOrganizationKey,
                    disableNotifications: false,
                    organizationKey: serverUrlOrOrganizationKey,
                    region
                };
                const tokenStorageKey = getTokenStorageKey(connection);
                const sonarCloudToken = token || (await ConnectionSettingsService.instance.getServerToken(tokenStorageKey));
                connection.token = sonarCloudToken;

                return await ConnectionSettingsService.instance.addSonarCloudConnection(connection);
            } else if (!isSonarCloud && token) {
                const connection: SonarQubeConnection = {
                    token,
                    connectionId: serverUrlOrOrganizationKey,
                    disableNotifications: false,
                    serverUrl: serverUrlOrOrganizationKey
                };
                return await ConnectionSettingsService.instance.addSonarQubeConnection(connection);
            } else {
                throw new AutomaticConnectionSetupCancellationError("Automatic Connection setup cancelled");
            }
        } else if (!reply.confirmed && !reply.cancelled) {
            coc.commands.executeCommand(Commands.HELP_AND_FEEDBACK_LINK, "connectedModeDocs");
            throw new AutomaticConnectionSetupCancellationError("Automatic Connection setup was cancelled; Opening documentation");
        }
        throw new AutomaticConnectionSetupCancellationError("Automatic Connection setup was cancelled by the user");
    };
}
