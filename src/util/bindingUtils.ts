/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

"use strict";

import * as coc from "coc.nvim";
import { ServerType } from "../connected/connections";
import { BindingSuggestion } from "../lsp/protocol";
import { ProjectBinding } from "../connected/binding";
import { SONARLINT_CATEGORY } from "../settings/settings";
import { SonarCloudRegion } from "../settings/connectionsettings";

const EU_SONARCLOUD_BASE_URL = "https://sonarcloud.io";
const US_SONARCLOUD_BASE_URL = "https://sonarqube.us";

export const SONARCLOUD_REGION_URL_MAP: Record<SonarCloudRegion, string> = {
    EU: EU_SONARCLOUD_BASE_URL,
    US: US_SONARCLOUD_BASE_URL
};

export function serverProjectsToQuickPickItems(serverProjects: BindingSuggestion[], serverType: ServerType) {
    const itemsList: coc.QuickPickItem[] = [];
    if (serverProjects) {
        for (const project of serverProjects) {
            itemsList.push({
                label: project.sonarProjectName,
                description: project.sonarProjectKey,
                buttons: [
                    {
                        tooltip: `View in ${serverType}`
                    }
                ]
            } as AutoBindProjectQuickPickItem);
        }
    }
    return itemsList;
}

export function buildProjectOverviewBaseServerUrl(serverType: ServerType, serverUrlOrOrganizationKey: string, region?: SonarCloudRegion) {
    if (serverType === ServerType.SonarCloud) {
        const cloudUrl = region ? SONARCLOUD_REGION_URL_MAP[region] : SONARCLOUD_REGION_URL_MAP["EU"];
        return `${cloudUrl}/project/overview`;
    }
    return `${serverUrlOrOrganizationKey}/dashboard`;
}

export interface AutoBindProjectQuickPickItem extends coc.QuickPickItem {
    connectionId?: string;
}

export function getConnectionIdForFile(fileUri: string) {
    const workspaceFolder = coc.workspace.getWorkspaceFolder(coc.Uri.file(fileUri));
    const bindingConfig = coc.workspace
        .getConfiguration(SONARLINT_CATEGORY, workspaceFolder?.uri)
        .get<ProjectBinding>("connectedMode.project");
    return bindingConfig?.connectionId ?? "";
}
