/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { getCurrentIdeWithMCPSupport } from "./aiAgentUtils";
import { getCurrentSonarQubeMCPServerConfig } from "./mcpServerConfig";
import { isSonarQubeRulesFileConfigured } from "./aiAgentRuleConfig";
import { Commands } from "../util/commands";
import { ExtendedTreeItem } from "../util/types";

export class AIAgentsConfigurationItem extends ExtendedTreeItem {
    constructor(
        public readonly id: string,
        public readonly label: string,
        public readonly isConfigured: boolean,
        public readonly tooltipText?: string,
        public readonly configureCommand?: string,
        public readonly reconfigureCommand?: string
    ) {
        super(label, coc.TreeItemCollapsibleState.None);
        this.id = id;
        this.tooltip = this.getTooltip();
        this.contextValue = "aiAgentConfig";
        this.command = {
            command: (isConfigured ? reconfigureCommand || configureCommand : configureCommand) as string,
            title: isConfigured ? "Reconfigure" : "Configure",
            arguments: [this]
        };
    }

    private getTooltip(): string {
        if (this.isConfigured) {
            return this.tooltipText ? `${this.tooltipText} Configured` : "Configured";
        } else {
            return "Not configured";
        }
    }
}

export class AIAgentsConfigurationTreeDataProvider implements coc.TreeDataProvider<AIAgentsConfigurationItem> {
    private readonly _onDidChangeTreeData = new coc.Emitter<AIAgentsConfigurationItem | undefined>();
    readonly onDidChangeTreeData: coc.Event<AIAgentsConfigurationItem | undefined> = this._onDidChangeTreeData.event;

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    async getChildren(element?: AIAgentsConfigurationItem): Promise<AIAgentsConfigurationItem[]> {
        if (element) {
            return [];
        }

        const items: AIAgentsConfigurationItem[] = [];

        const sonarQubeMCPServerConfigured = getCurrentSonarQubeMCPServerConfig() !== undefined;
        const rulesFileConfigured = await isSonarQubeRulesFileConfigured();

        if (!sonarQubeMCPServerConfigured && !rulesFileConfigured) {
            await coc.window.showWarningMessage("There are no MCP server configurations");
            return [];
        }

        items.push(
            new AIAgentsConfigurationItem(
                "mcpServer",
                "Configure SonarQube MCP Server",
                sonarQubeMCPServerConfigured,
                "AI agent integration",
                Commands.CONFIGURE_MCP_SERVER,
                Commands.OPEN_MCP_SERVER_CONFIGURATION
            )
        );

        if (getCurrentIdeWithMCPSupport() === "cursor") {
            // rule file creation is only supported for cursor
            items.push(
                new AIAgentsConfigurationItem(
                    "rulesFile",
                    "Create Instructions for AI agents",
                    rulesFileConfigured,
                    "SonarQube MCP Server guide",
                    Commands.INTRODUCE_SONARQUBE_RULES_FILE,
                    Commands.OPEN_SONARQUBE_RULES_FILE
                )
            );
        }

        return items;
    }

    getTreeItem(element: AIAgentsConfigurationItem): ExtendedTreeItem {
        return element;
    }
}
