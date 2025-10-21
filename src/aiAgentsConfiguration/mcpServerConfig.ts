/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as fs from "node:fs";
import * as fse from "fs";
import * as path from "node:path";
import * as coc from "coc.nvim";
import { logToSonarLintOutput } from "../util/logging";
import { AllConnectionsTreeDataProvider, Connection } from "../connected/connections";
import { ConnectionSettingsService } from "../settings/connectionsettings";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import * as os from "node:os";
import { focusResourceLocation, getVSCodeSettingsBaseDir as getSettingsBaseDir } from "../util/util";
import { getCurrentIdeWithMCPSupport, IDE } from "./aiAgentUtils";

interface MCPServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

interface MCPConfigurationOthers {
    mcpServers: Record<string, MCPServerConfig>;
}

interface MCPConfigurationVSCode {
    servers: Record<string, MCPServerConfig>;
}

export function getMCPConfigPath(): string {
    const currentIDE = getCurrentIdeWithMCPSupport();
    switch (currentIDE) {
        case IDE.CURSOR:
            return path.join(os.homedir(), ".cursor", "mcp.json");
        case IDE.WINDSURF:
            return path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
        case IDE.VSCODE:
            return path.join(getSettingsBaseDir(), "Code", "User", "mcp.json");
        default:
            throw new Error(`Unsupported IDE: ${currentIDE}`);
    }
}

export function getCurrentSonarQubeMCPServerConfig(): MCPServerConfig | undefined {
    const currentIDE = getCurrentIdeWithMCPSupport();
    if (!currentIDE) {
        return undefined;
    }
    const configPath = getMCPConfigPath();
    const config = readMCPConfig(configPath);
    return currentIDE === IDE.VSCODE
        ? (config as MCPConfigurationVSCode).servers?.sonarqube
        : (config as MCPConfigurationOthers).mcpServers?.sonarqube;
}

function readMCPConfig(configPath: string): MCPConfigurationOthers | MCPConfigurationVSCode {
    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, "utf8");
            return JSON.parse(content);
        }
    } catch (error) {
        logToSonarLintOutput(`Error reading MCP config: ${(error as Error).message}`);
    }

    const currentIDE = getCurrentIdeWithMCPSupport();
    return currentIDE === "vscode"
        ? {
              servers: {}
          }
        : {
              mcpServers: {}
          };
}

function writeSonarQubeMCPConfig(sonarQubeMCPConfig: MCPServerConfig): void {
    try {
        const currentIDE = getCurrentIdeWithMCPSupport();
        const configPath = getMCPConfigPath();
        const config = readMCPConfig(configPath);

        if (currentIDE === IDE.VSCODE) {
            (config as MCPConfigurationVSCode).servers.sonarqube = sonarQubeMCPConfig;
        } else {
            (config as MCPConfigurationOthers).mcpServers.sonarqube = sonarQubeMCPConfig;
        }

        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        const content = JSON.stringify(config, null, 2);
        fs.writeFileSync(configPath, content, "utf8");

        logToSonarLintOutput(`MCP configuration updated: ${configPath}`);
    } catch (error) {
        logToSonarLintOutput(`Error writing MCP config: ${(error as Error).message}`);
        throw error;
    }
}

export async function configureMCPServer(
    languageClient: SonarLintExtendedLanguageClient,
    allConnectionsTreeDataProvider: AllConnectionsTreeDataProvider,
    connection?: Connection
): Promise<void> {
    try {
        const selectedConnection = await getSelectedConnection(allConnectionsTreeDataProvider, connection);

        if (!selectedConnection) {
            return;
        }

        const token = await ConnectionSettingsService.instance.getTokenForConnection(selectedConnection);

        if (!token) {
            const proceed = await coc.window.showWarningMessage(
                `The SonarQube connection "${selectedConnection.label}" doesn't have a token configured. The MCP server will be created but may not function properly without a valid token.`,
                "Proceed Anyway",
                "Cancel"
            );

            if (proceed !== "Proceed Anyway") {
                return;
            }
        }

        const sonarQubeMCPConfig = await languageClient.getMCPServerConfiguration(selectedConnection.id, token as string);

        writeSonarQubeMCPConfig(JSON.parse(sonarQubeMCPConfig.jsonConfiguration));

        openMCPServersListIfCursor();

        const openFile = await coc.window.showInformationMessage(
            `SonarQube MCP server configured for "${selectedConnection.label}"`,
            "Open Configuration File"
        );

        if (openFile === "Open Configuration File") {
            openMCPServerConfigurationFile();
        }

        logToSonarLintOutput(`SonarQube MCP server configured successfully for connection: ${selectedConnection.label}`);
    } catch (error) {
        const connectionLabel = connection?.label || "unknown connection";
        const errorMessage = `Failed to configure SonarQube MCP server for "${connectionLabel}": ${(error as Error).message}`;
        coc.window.showErrorMessage(errorMessage);
        logToSonarLintOutput(errorMessage);
        throw error;
    }
}

async function getSelectedConnection(
    allConnectionsTreeDataProvider: AllConnectionsTreeDataProvider,
    connection?: Connection
): Promise<Connection | undefined> {
    if (connection) {
        return connection;
    }

    const allConnections = [
        ...(await allConnectionsTreeDataProvider.getConnections("__sonarqube__")),
        ...(await allConnectionsTreeDataProvider.getConnections("__sonarcloud__"))
    ];

    if (allConnections.length === 0) {
        warnNoConnectionConfigured();
        return undefined;
    } else if (allConnections.length === 1) {
        return allConnections[0];
    } else {
        const connectionItems = allConnections.map((conn) => ({
            label: conn.label,
            description: conn.contextValue === "sonarqubeConnection" ? "SonarQube Server" : "SonarQube Cloud",
            connection: conn
        }));

        const selectedItem = await coc.window.showQuickPick(connectionItems, {
            placeHolder: "Select a SonarQube connection for MCP server configuration",
            matchOnDescription: true
        });

        if (!selectedItem) {
            return undefined;
        }

        return selectedItem.connection;
    }
}

function warnNoConnectionConfigured() {
    coc.window
        .showWarningMessage("No SonarQube (Server or Cloud) connections found. Please set up a connection first.", "Set up Connection")
        .then((action) => {
            if (action === "Set up Connection") {
                coc.commands.executeCommand("SonarLint.ConnectedMode.focus");
            }
        });
}

function openMCPServersListIfCursor() {
    const currentIDE = getCurrentIdeWithMCPSupport();
    if (currentIDE === IDE.CURSOR) {
        openMCPServerConfigurationFile();
    }
}

export function onEmbeddedServerStarted(port: number): void {
    const currentSonarQubeMCPConfig = getCurrentSonarQubeMCPServerConfig();
    if (!currentSonarQubeMCPConfig) {
        coc.window.showWarningMessage("There are no MCP server configurations");
        return;
    }

    if (currentSonarQubeMCPConfig?.env) {
        currentSonarQubeMCPConfig.env.SONARQUBE_IDE_PORT = port.toString();
    }
    writeSonarQubeMCPConfig(currentSonarQubeMCPConfig);
}

export async function openMCPServerConfigurationFile(): Promise<void> {
    const cfgPath = getMCPConfigPath();
    const uri = coc.Uri.file(cfgPath);

    try {
        fse.mkdirSync(path.dirname(uri.fsPath), { recursive: true });

        if (!fse.existsSync(uri.fsPath)) {
            const defaultConfig = {
                // Minimal MCP client config example; extend as your client expects.
                // For Claude Code / generic MCP-capable clients using stdio via Docker:
                mcpServers: {
                    sonarqube: {
                        type: "stdio",
                        command: "docker",
                        args: ["run", "-i", "--rm", "-e", "SONARQUBE_TOKEN", "-e", "SONARQUBE_URL", "mcp/sonarqube"],
                        env: {
                            SONARQUBE_TOKEN: "<PUT_YOUR_USER_TOKEN_HERE>",
                            SONARQUBE_URL: "http://localhost:9000"
                            // If using SonarCloud instead, set:
                            // "SONARQUBE_ORG": "<your-org-key>"
                        }
                    }
                }
            };
            fse.writeFileSync(uri.fsPath, JSON.stringify(defaultConfig, null, 2) + "\n", { encoding: "utf8" });
            coc.window.showInformationMessage(`Created new MCP configuration file ${uri.fsPath}`);
        }
        await focusResourceLocation(uri);
    } catch (err) {
        coc.window.showWarningMessage(`Failed to open/create MCP config: ${String(err)}`);
    }
}
