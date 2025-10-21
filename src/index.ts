/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

// Must be kept at the top for Node instrumentation to work correctly

import * as ChildProcess from "child_process";
import * as coc from "coc.nvim";
import { DateTime } from "luxon";
import * as Path from "path";
import { introduceSonarQubeRulesFile, openSonarQubeRulesFile } from "./aiAgentsConfiguration/aiAgentRuleConfig";
import {
    AIAgentsConfigurationItem,
    AIAgentsConfigurationTreeDataProvider
} from "./aiAgentsConfiguration/aiAgentsConfigurationTreeDataProvider";
import { configureMCPServer, onEmbeddedServerStarted, openMCPServerConfigurationFile } from "./aiAgentsConfiguration/mcpServerConfig";
import { configureCompilationDatabase, notifyMissingCompileCommands } from "./cfamily/cfamily";
import { assistCreatingConnection } from "./connected/assistCreatingConnection";
import { AutoBindingService } from "./connected/autobinding";
import { BindingService, showSoonUnsupportedVersionMessage } from "./connected/binding";
import { showConnectionDetails } from "./connected/connectionpanel";
import { AllConnectionsTreeDataProvider, ConnectionsNode, ConnectionType } from "./connected/connections";
import { connectToSonarCloud, connectToSonarQube } from "./connected/connectionsetup";
import { SharedConnectedModeSettingsService } from "./connected/sharedConnectedModeSettingsService";
import { FileSystemServiceImpl } from "./fileSystem/fileSystemServiceImpl";
import { FindingsTreeDataProvider, FindingsTreeViewItem } from "./findings/findingsTreeDataProvider";
import { FilterType, FindingType, getFilterDisplayName, selectAndApplyCodeAction } from "./findings/findingsTreeDataProviderUtil";
import { FindingNode } from "./findings/findingTypes/findingNode";
import { NotebookFindingNode } from "./findings/findingTypes/notebookFindingNode";
import { FixSuggestionService } from "./fixSuggestions/fixSuggestionsService";
import { HelpAndFeedbackItem } from "./help/constants";
import { HelpAndFeedbackLink, HelpAndFeedbackTreeDataProvider } from "./help/helpAndFeedbackTreeDataProvider";
import {
    changeHotspotStatus,
    getFilesForHotspotsAndLaunchScan,
    showHotspotDescription,
    showHotspotDetails,
    showSecurityHotspot,
    useProvidedFolderOrPickManuallyAndScan
} from "./hotspot/hotspots";
import { IssueService } from "./issue/issue";
import { resolveIssueMultiStepInput } from "./issue/resolveIssue";
import { getJavaConfig, installClasspathListener } from "./java/java";
import { LocationTreeItem, navigateToLocation, SecondaryLocationsTree } from "./location/locations";
import { SonarLintExtendedLanguageClient } from "./lsp/client";
import { ConnectionCheckResult, ExtendedClient, ExtendedServer } from "./lsp/protocol";
import { languageServerCommand } from "./lsp/server";
import { NewCodeDefinitionService } from "./newcode/newCodeDefinitionService";
import { maybeShowWiderLanguageSupportNotification } from "./promotions/promotionalNotifications";
import { showRuleDescription } from "./rules/rulepanel";
import { AllRulesNode, AllRulesTreeDataProvider, setRulesViewMessage, toggleRule, userNormalizedLanguageKey } from "./rules/rules";
import { showNotificationForFirstSecretsIssue } from "./secrets/secrets";
import { AutomaticAnalysisService } from "./settings/automaticAnalysis";
import { ConnectionSettingsService } from "./settings/connectionsettings";
import { enableVerboseLogs, isVerboseEnabled, loadInitialSettings, onConfigurationChange } from "./settings/settings";
import { getConnectionIdForFile } from "./util/bindingUtils";
import { Commands } from "./util/commands";
import { getLogOutput, initLogOutput, logToSonarLintOutput, showLogOutput } from "./util/logging";
import { getPlatform } from "./util/platform";
import { installManagedJre, JAVA_HOME_CONFIG, resolveRequirements } from "./util/requirements";
import { CAN_SHOW_MISSING_REQUIREMENT_NOTIF, showSslCertificateConfirmationDialog } from "./util/showMessage";
import * as util from "./util/util";
import { filterOutFilesIgnoredForAnalysis, shouldAnalyseFile } from "./util/util";
import { createBlendingBackgroundHighlight, createDefaultRenderingHighlights } from "./util/webview";

const DOCUMENT_SELECTOR = [{ scheme: "file", pattern: "**/*" }];

let aiAgentsConfigurationTreeDataProvider: AIAgentsConfigurationTreeDataProvider;
let allConnectionsTreeDataProvider: AllConnectionsTreeDataProvider;
let allRulesTreeDataProvider: AllRulesTreeDataProvider;
let findingsTreeDataProvider: FindingsTreeDataProvider;
let helpAndFeedbackTreeDataProvider: HelpAndFeedbackTreeDataProvider;
let languageClient: SonarLintExtendedLanguageClient;
let secondaryLocationTreeDataProvider: SecondaryLocationsTree;

let allConnectionsView: coc.TreeView<ConnectionsNode>;
let allRulesView: coc.TreeView<AllRulesNode>;
let findingsView: coc.TreeView<FindingsTreeViewItem>;
let helpAndFeedbackView: coc.TreeView<HelpAndFeedbackLink>;
let issueLocationsView: coc.TreeView<LocationTreeItem>;
let aiAgentsConfigurationView: coc.TreeView<AIAgentsConfigurationItem>;

let floatDescriptionFactory: coc.FloatFactory;

const currentProgress: Record<string, { progress: coc.Progress<{ increment?: number }>; resolve: () => void } | undefined> = {};

async function runJavaServer(context: coc.ExtensionContext): Promise<coc.StreamInfo> {
    try {
        const requirements = await resolveRequirements(context);
        const { command, args } = await languageServerCommand(context, requirements);
        logToSonarLintOutput(`Executing ${command} ${args.join(" ")}`);
        const process = ChildProcess.spawn(command, args);
        process.stderr.on("data", function (data) {
            logWithPrefix(data, "[stderr]");
        });
        return {
            reader: process.stdout,
            writer: process.stdin
        };
    } catch (error) {
        //show error
        const errorPayload: any = error as any;
        coc.window.showErrorMessage(errorPayload.message).then((selection) => {
            if (errorPayload.label && errorPayload.label === selection && errorPayload.command) {
                coc.commands.executeCommand(errorPayload.command, errorPayload.commandParam);
            }
        });
        // rethrow to disrupt the chain.
        throw error;
    }
}

function logWithPrefix(data: { toString: () => string }, prefix: string) {
    if (isVerboseEnabled()) {
        const lines: string[] = data.toString().split(/\r\n|\r|\n/);
        lines.forEach((l: string) => {
            if (l.length > 0) {
                logToSonarLintOutput(`${prefix} ${l}`);
            }
        });
    }
}

export function toUrl(filePath: string) {
    let pathName = Path.resolve(filePath).replace(/\\/g, "/");

    // Windows drive letter must be prefixed with a slash
    if (!pathName.startsWith("/")) {
        pathName = "/" + pathName;
    }

    return encodeURI("file://" + pathName);
}

export async function activate(context: coc.ExtensionContext) {
    const installTimeKey = "install.time";
    // context.globalState.setKeysForSync([installTimeKey]);
    let installTime = context.globalState.get(installTimeKey);
    if (!installTime) {
        installTime = new Date().toISOString();
        context.globalState.update(installTimeKey, installTime);
    }

    loadInitialSettings();
    initLogOutput(context);
    util.setExtensionContext(context);

    floatDescriptionFactory = coc.window.createFloatFactory({});
    context.subscriptions.push(floatDescriptionFactory);
    await createDefaultRenderingHighlights();
    await createBlendingBackgroundHighlight();

    const serverOptions = () => runJavaServer(context);

    const pythonWatcher = coc.workspace.createFileSystemWatcher("**/*.py");
    const helmWatcher = coc.workspace.createFileSystemWatcher("**/*.{y?ml,tpl,txt,toml}");
    const sharedConnectedModeConfigurationWatcher = coc.workspace.createFileSystemWatcher("**/.sonarlint/*.json");
    context.subscriptions.push(pythonWatcher);
    context.subscriptions.push(helmWatcher);
    context.subscriptions.push(sharedConnectedModeConfigurationWatcher);

    // Options to control the language client
    const clientOptions: coc.LanguageClientOptions = {
        middleware: {
            handleDiagnostics: (uri, diagnostics, next) => {
                FindingsTreeDataProvider.instance.updateIssues(uri.toString(), diagnostics);
                next(uri, diagnostics); // Call the default handler
            }
        },
        documentSelector: DOCUMENT_SELECTOR,
        synchronize: {
            fileEvents: [pythonWatcher, helmWatcher, sharedConnectedModeConfigurationWatcher]
        },
        diagnosticCollectionName: "sonarlint",
        initializationOptions: () => {
            return {
                productKey: "vscode",
                productName: "SonarLint",
                productVersion: "1.0.0",
                workspaceName: coc.workspace.root,
                // firstSecretDetected: isFirstSecretDetected(context),
                showVerboseLogs: true, //coc.workspace.getConfiguration().get("sonarlint.output.showVerboseLogs", false),
                platform: getPlatform(),
                architecture: process.arch,
                // enableNotebooks: true,
                // clientNodePath: coc.workspace.getConfiguration().get("sonarlint.pathToNodeExecutable"),
                // eslintBridgeServerPath: Path.resolve(context.extensionPath, "eslint-bridge"),
                omnisharpDirectory: Path.resolve(context.extensionPath, "omnisharp"),
                csharpOssPath: Path.resolve(context.extensionPath, "analyzers", "sonarcsharp.jar"),
                csharpEnterprisePath: Path.resolve(context.extensionPath, "analyzers", "csharpenterprise.jar"),
                connections: coc.workspace
                    .getConfiguration("sonarlint.connectedMode")
                    .get("connections", { sonarqube: [], sonarcloud: [] }),
                rules: coc.workspace.getConfiguration("sonarlint").get("rules", {}),
                focusOnNewCode: coc.workspace.getConfiguration("sonarlint").get("focusOnNewCode", false),
                automaticAnalysis: coc.workspace.getConfiguration("sonarlint").get("automaticAnalysis", true)
            };
        },
        outputChannel: getLogOutput(),
        revealOutputChannelOn: 4 // never
    };

    // Create the language client and start the client.
    // id parameter is used to load 'sonarlint.trace.server' configuration
    languageClient = new SonarLintExtendedLanguageClient("sonarlint", "SonarLint Language Server", serverOptions, clientOptions);

    await languageClient.start();

    ConnectionSettingsService.init(context, languageClient);
    NewCodeDefinitionService.init(context, languageClient);
    FileSystemServiceImpl.init();
    SharedConnectedModeSettingsService.init(languageClient, FileSystemServiceImpl.instance, context, floatDescriptionFactory);
    BindingService.init(
        languageClient,
        context.workspaceState,
        ConnectionSettingsService.instance,
        SharedConnectedModeSettingsService.instance
    );
    AutoBindingService.init(
        BindingService.instance,
        context.workspaceState,
        ConnectionSettingsService.instance,
        FileSystemServiceImpl.instance,
        languageClient
    );
    FixSuggestionService.init(languageClient);
    FindingsTreeDataProvider.init(languageClient);

    findingsTreeDataProvider = FindingsTreeDataProvider.instance;
    findingsView = coc.window.createTreeView("SonarQube.Findings", {
        bufhidden: "hide",
        treeDataProvider: findingsTreeDataProvider
    });
    context.subscriptions.push(findingsView);

    context.subscriptions.push(
        coc.extensions.onDidLoadExtension(() => {
            installClasspathListener(languageClient);
        })
    );
    installClasspathListener(languageClient);
    installCustomRequestHandlers(context);

    coc.window.onDidChangeActiveTextEditor((e) => {
        FindingsTreeDataProvider.instance.refresh();
    });

    allRulesTreeDataProvider = new AllRulesTreeDataProvider(() => languageClient.listAllRules());
    allRulesView = coc.window.createTreeView("SonarLint.AllRules", {
        bufhidden: "hide",
        treeDataProvider: allRulesTreeDataProvider
    });
    setRulesViewMessage(allRulesView);
    context.subscriptions.push(allRulesView);

    secondaryLocationTreeDataProvider = new SecondaryLocationsTree();
    issueLocationsView = coc.window.createTreeView("SonarLint.IssueLocations", {
        bufhidden: "hide",
        treeDataProvider: secondaryLocationTreeDataProvider
    }) as coc.TreeView<LocationTreeItem>;
    context.subscriptions.push(issueLocationsView);

    IssueService.init(languageClient, secondaryLocationTreeDataProvider, issueLocationsView);

    const automaticAnalysisService = new AutomaticAnalysisService(findingsView);
    automaticAnalysisService.updateAutomaticAnalysisStatusBarAndFindingsViewMessage();

    coc.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration("sonarlint.rules")) {
            allRulesTreeDataProvider.refresh();
            setRulesViewMessage(allRulesView);
        }
        if (event.affectsConfiguration("sonarlint.connectedMode")) {
            allConnectionsTreeDataProvider.refresh();
        }
        if (event.affectsConfiguration("sonarlint.focusOnNewCode")) {
            findingsTreeDataProvider.refresh();
        }
        if (event.affectsConfiguration("sonarlint.automaticAnalysis")) {
            automaticAnalysisService.updateAutomaticAnalysisStatusBarAndFindingsViewMessage();
        }
        if (event.affectsConfiguration("sonarlint")) {
            // only send notification to let language server pull the latest settings when the change is relevant
            languageClient.sendNotification("workspace/didChangeConfiguration", { settings: null });
        }
    });

    coc.workspace.onDidChangeWorkspaceFolders(async (event) => {
        for (const removed of event.removed) {
            FileSystemServiceImpl.instance.didRemoveWorkspaceFolder(removed);
        }

        for (const added of event.added) {
            FileSystemServiceImpl.instance.didAddWorkspaceFolder(added);
        }
    });

    registerCommands(context);

    allConnectionsTreeDataProvider = new AllConnectionsTreeDataProvider(languageClient);

    allConnectionsView = coc.window.createTreeView("SonarLint.ConnectedMode", {
        bufhidden: "hide",
        treeDataProvider: allConnectionsTreeDataProvider
    });
    context.subscriptions.push(allConnectionsView);

    // Update badge when tree data changes
    context.subscriptions.push(
        findingsTreeDataProvider.onDidChangeTreeData(() => {
            updateFindingsViewContainerBadge();
        })
    );

    helpAndFeedbackTreeDataProvider = new HelpAndFeedbackTreeDataProvider();
    helpAndFeedbackView = coc.window.createTreeView("SonarLint.HelpAndFeedback", {
        bufhidden: "hide",
        treeDataProvider: helpAndFeedbackTreeDataProvider
    });
    context.subscriptions.push(helpAndFeedbackView);

    aiAgentsConfigurationTreeDataProvider = new AIAgentsConfigurationTreeDataProvider();
    aiAgentsConfigurationView = coc.window.createTreeView("SonarLint.AIAgentsConfiguration", {
        bufhidden: "hide",
        treeDataProvider: aiAgentsConfigurationTreeDataProvider
    });
    context.subscriptions.push(aiAgentsConfigurationView);

    context.subscriptions.push(onConfigurationChange());
}

function suggestBinding(params: ExtendedClient.SuggestBindingParams) {
    logToSonarLintOutput(`Received binding suggestions: ${JSON.stringify(params)}`);
    AutoBindingService.instance.checkConditionsAndAttemptAutobinding(params);
}

function registerCommands(context: coc.ExtensionContext) {
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.ENABLE_LOGS_AND_SHOW_OUTPUT, () => {
            enableVerboseLogs();
            showLogOutput();
        }),
        coc.commands.registerCommand(Commands.SHOW_SONARLINT_OUTPUT, () => showLogOutput()),
        coc.commands.registerCommand(Commands.DUMP_BACKEND_THREADS, () => languageClient.dumpThreads()),
        coc.commands.registerCommand(Commands.INSTALL_MANAGED_JRE, installManagedJre),
        coc.commands.registerCommand(Commands.CONFIGURE_COMPILATION_DATABASE, configureCompilationDatabase),
        coc.commands.registerCommand(Commands.ENABLE_VERBOSE_LOGS, () => enableVerboseLogs()),
        coc.commands.registerCommand(Commands.SHOW_HELP_PANEL, () => util.showTargetView(helpAndFeedbackView, "Help")),
        coc.commands.registerCommand(Commands.ANALYSE_OPEN_FILE, () => {
            IssueService.instance.analyseOpenFileIgnoringExcludes(true);
            coc.commands.executeCommand(Commands.SHOW_ALL_FINDINGS);
        }),
        coc.commands.registerCommand("SonarLint.OpenSample", async () => {
            const sampleFileUri = coc.Uri.file(Path.join(context.extensionPath, "walkthrough", "sample.py"));
            const sampleDocument = await coc.workspace.openTextDocument(sampleFileUri);
            await util.focusResourceLocation(sampleDocument.uri);
        }),
        coc.commands.registerCommand(
            Commands.HELP_AND_FEEDBACK_LINK,
            async (item: HelpAndFeedbackItem) => {
                await coc.commands.executeCommand("vscode.open", coc.Uri.parse(item.url as string));
            },
            undefined,
            true
        )
    );

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.AUTO_BIND_WORKSPACE_FOLDERS, () => AutoBindingService.instance.autoBindWorkspace()),
        coc.commands.registerCommand(Commands.SHARE_CONNECTED_MODE_CONFIG, () =>
            SharedConnectedModeSettingsService.instance.askConfirmationAndCreateSharedConnectedModeSettingsFile(
                coc.workspace.getWorkspaceFolder(coc.workspace.root) as coc.WorkspaceFolder
            )
        ),
        coc.commands.registerCommand(
            Commands.SHOW_ALL_CONNECTIONS,
            async () => await util.showTargetView(allConnectionsView, "Connections")
        ),
        coc.commands.registerCommand(
            Commands.CONNECT_TO_SONARQUBE,
            async () => await connectToSonarQube(context, floatDescriptionFactory)(),
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.CONNECT_TO_SONARCLOUD,
            async () => await connectToSonarCloud(context, floatDescriptionFactory)(),
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.SHOW_ALL_INFO_FOR_CONNECTION,
            (connectionBinding) => {
                ConnectionSettingsService.instance.showAllInfoForConnection(connectionBinding);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(Commands.SHOW_CONNECTION_INFO, showConnectionDetails(floatDescriptionFactory), undefined, true),
        coc.commands.registerCommand(
            Commands.ADD_PROJECT_BINDING,
            (connectionBinding) => BindingService.instance.createOrEditBinding(connectionBinding.id, connectionBinding.contextValue),
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.EDIT_PROJECT_BINDING,
            (connectionBinding) =>
                BindingService.instance.createOrEditBinding(
                    connectionBinding.connectionId,
                    connectionBinding.contextValue,
                    connectionBinding.uri,
                    connectionBinding.serverType
                ),
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.REMOVE_PROJECT_BINDING,
            (connectionBinding) => BindingService.instance.deleteBindingWithConfirmation(connectionBinding),
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.FOCUS_ON_CONNECTION,
            async (connectionType: ConnectionType, connectionId?: string) => {
                await util.showTargetView(allConnectionsView, "Connections");
                const connectionsOfType = await allConnectionsTreeDataProvider.getConnections(connectionType);
                const targetConnection = connectionsOfType.find((c) => c.id === connectionId) ?? connectionsOfType[0];
                await allConnectionsView.reveal(targetConnection, { select: true, focus: true, expand: false });
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.CONFIGURE_MCP_SERVER,
            (connection) => {
                configureMCPServer(languageClient, allConnectionsTreeDataProvider, connection);
                aiAgentsConfigurationTreeDataProvider.refresh();
            },
            undefined,
            true
        )
    );

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.SHOW_ALL_RULES, async () => {
            allRulesTreeDataProvider.filter();
            await util.showTargetView(allRulesView, "Rules");
        }),
        coc.commands.registerCommand(Commands.SHOW_ACTIVE_RULES, async () => {
            allRulesTreeDataProvider.filter("on");
            await util.showTargetView(allRulesView, "Active Rules");
        }),
        coc.commands.registerCommand(Commands.SHOW_INACTIVE_RULES, async () => {
            allRulesTreeDataProvider.filter("off");
            await util.showTargetView(allRulesView, "Inactive Rules");
        }),
        coc.commands.registerCommand(Commands.OPEN_RULE_BY_KEY, async (ruleKey) => {
            ruleKey = ruleKey || (await coc.window.requestInput("Enter Language or Rule", "", {}));
            if (!ruleKey || ruleKey.length == 0) {
                coc.window.showWarningMessage(`Provided empty or invalid key or rule`);
                return;
            }
            allRulesTreeDataProvider.filter();
            ruleKey = ruleKey.toLowerCase();
            await util.showTargetView(allRulesView, `All Rules`);
            const indexOfSeparator = ruleKey.indexOf(":");
            const sourceLanguageName = indexOfSeparator > 0 ? ruleKey.substring(0, indexOfSeparator) : ruleKey;
            const languageName = userNormalizedLanguageKey(sourceLanguageName.toLowerCase());
            const allRules: ExtendedServer.RulesResponse = await allRulesTreeDataProvider.getAllRules();

            const matchingRules: Array<ExtendedServer.Rule> = allRules[languageName];
            if (matchingRules && matchingRules.length > 0) {
                const parentNode = allRulesTreeDataProvider.getTreeElement(languageName);
                parentNode.collapsibleState = coc.TreeItemCollapsibleState.Expanded;
                await allRulesView.reveal(parentNode, { select: true, focus: true, expand: true });

                let ruleId =
                    indexOfSeparator >= 0 && ruleKey.length > indexOfSeparator + 1 ? ruleKey.substring(indexOfSeparator + 1) : undefined;
                if (ruleId && ruleId !== undefined) {
                    ruleId = `${languageName}:${ruleId}`.toLowerCase();
                    const foundRule: ExtendedServer.Rule | undefined = matchingRules.find((rule) => {
                        return rule.key.toLowerCase().startsWith(ruleId as string);
                    });
                    if (foundRule && foundRule !== undefined) {
                        let ruleNode = allRulesTreeDataProvider.getTreeElement(foundRule.key.toLowerCase());
                        !ruleNode || (await allRulesTreeDataProvider.getChildren(parentNode));
                        ruleNode = allRulesTreeDataProvider.getTreeElement(foundRule.key.toLowerCase());
                        await allRulesView.reveal(ruleNode, { select: true, focus: true, expand: false });
                    } else {
                        coc.window.showWarningMessage(`Unable to find or resolve rule ${ruleId}`);
                    }
                }
                return true;
            } else {
                coc.window.showWarningMessage(`Unable to find or resolve langauge ${languageName}`);
            }
        }),
        coc.commands.registerCommand(
            Commands.DEACTIVATE_RULE,
            async (ruleKey: string | ExtendedServer.Rule) => {
                await toggleRule("off")(ruleKey);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.ACTIVATE_RULE,
            async (ruleKey: string | ExtendedServer.Rule) => {
                await toggleRule("on")(ruleKey);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.TOGGLE_RULE,
            async (ruleKey: string | ExtendedServer.Rule) => {
                await toggleRule()(ruleKey);
            },
            undefined,
            true
        )
    );

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.SHOW_ALL_FINDINGS, async () => {
            FindingsTreeDataProvider.instance.setFilter(FilterType.All);
            await util.showTargetView(findingsView, "Findings");
        }),
        coc.commands.registerCommand(Commands.SHOW_FIXABLE_ISSUES_ONLY, async () => {
            FindingsTreeDataProvider.instance.setFilter(FilterType.Fix_Available);
            await util.showTargetView(findingsView, "Fixable Findings");
        }),
        coc.commands.registerCommand(Commands.SHOW_OPEN_FILES_ONLY, async () => {
            FindingsTreeDataProvider.instance.setFilter(FilterType.Open_Files_Only);
            await util.showTargetView(findingsView, "Opened files Findings");
        }),
        coc.commands.registerCommand(Commands.SHOW_CURRENT_FILE_ONLY, async () => {
            FindingsTreeDataProvider.instance.setFilter(FilterType.Current_File_Only);
            await util.showTargetView(findingsView, "Current files Findings");
        }),
        coc.commands.registerCommand(Commands.SHOW_HIGH_SEVERITY_ONLY, async () => {
            FindingsTreeDataProvider.instance.setFilter(FilterType.High_Severity_Only);
            await util.showTargetView(findingsView, "High severity Findings");
        }),
        coc.commands.registerCommand(Commands.SCAN_FOR_HOTSPOTS_IN_FOLDER, async (folder) => {
            await scanFolderForHotspotsCommandHandler(folder);
        }),
        coc.commands.registerCommand(Commands.SHOW_HOTSPOT_DESCRIPTION, showHotspotDescription(floatDescriptionFactory), undefined, true),
        coc.commands.registerCommand(
            Commands.SHOW_HOTSPOT_DETAILS,
            async (hotspot: FindingNode) => {
                const hotspotDetails = await languageClient.getHotspotDetails(hotspot.key, hotspot.fileUri);
                await showHotspotDetails(hotspotDetails, hotspot, floatDescriptionFactory);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.SHOW_HOTSPOT_RULE_DESCRIPTION,
            (hotspot: FindingNode) => languageClient.showHotspotRuleDescription(hotspot.key, hotspot.fileUri),
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.OPEN_HOTSPOT_ON_SERVER,
            (hotspot: FindingNode) => languageClient.openHotspotOnServer(hotspot.key, hotspot.fileUri),
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.CHANGE_HOTSPOT_STATUS,
            (hotspot: FindingNode) => changeHotspotStatus(hotspot.serverIssueKey as string, hotspot.fileUri, languageClient),
            undefined,
            true
        ),
        coc.commands.registerCommand(Commands.CLEAR_HOTSPOT_HIGHLIGHTING, clearLocations, undefined, true),
        coc.commands.registerCommand(Commands.FORGET_FOLDER_HOTSPOTS, () => languageClient.forgetFolderHotspots(), undefined, true),
        coc.commands.registerCommand(
            Commands.REOPEN_LOCAL_ISSUES,
            () => {
                IssueService.instance.reopenLocalIssues();
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(Commands.SHOW_ALL_LOCATIONS, showAllLocations, undefined, true),
        coc.commands.registerCommand(Commands.NAVIGATE_TO_LOCATION, navigateToLocation, undefined, true),
        coc.commands.registerCommand(Commands.CLEAR_LOCATIONS, clearLocations, undefined, true),
        coc.commands.registerCommand(
            Commands.RESOLVE_ISSUE,
            (workspaceUri: string, issueKey: string, fileUri: string, isTaintIssue: boolean, isDependencyRisk = false) =>
                resolveIssueMultiStepInput(workspaceUri, issueKey, fileUri, isTaintIssue, isDependencyRisk),
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.SHOW_HOTSPOT_LOCATION,
            (hotspot: FindingNode) => languageClient.showHotspotLocations(hotspot.key, hotspot.fileUri),
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.CHANGE_DEPENDENCY_RISK_STATUS,
            async (finding: FindingNode) => {
                FindingsTreeDataProvider.instance.changeDependencyRiskStatus(finding);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.SHOW_ALL_INFO_FOR_FINDING,
            (finding: FindingNode) => {
                FindingsTreeDataProvider.instance.showAllInfoForFinding(finding);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.TRIGGER_BROWSE_TAINT_COMMAND,
            (finding: FindingNode) => {
                // call server-side command to open the taint vulnerability on the remote server
                coc.commands.executeCommand("SonarLint.BrowseTaintVulnerability", finding.serverIssueKey || finding.key, finding.fileUri);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.TRIGGER_AI_CODE_FIX_COMMAND,
            (finding: FindingNode) => {
                // call server-side command to to suggest fix
                coc.commands.executeCommand("SonarLint.SuggestFix", finding.key, finding.fileUri);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.NAVIGATE_FINDING_LOCATION,
            async (finding: FindingNode) => {
                if (finding.findingType === FindingType.SecurityHotspot) {
                    await coc.commands.executeCommand(Commands.SHOW_HOTSPOT_LOCATION, finding);
                } else if (finding.findingType === FindingType.TaintVulnerability) {
                    await coc.commands.executeCommand(
                        "SonarLint.ShowTaintVulnerabilityFlows",
                        finding.serverIssueKey,
                        getConnectionIdForFile(finding.fileUri)
                    );
                    util.hideTargetView(findingsView);
                } else if (finding.findingType === FindingType.Issue) {
                    if (!(finding instanceof NotebookFindingNode)) {
                        // showing all locations for notebook cells is not supported
                        await coc.commands.executeCommand("SonarLint.ShowIssueFlows", finding.key, finding.fileUri);
                    }
                    util.hideTargetView(findingsView);
                } else if (finding.findingType === FindingType.DependencyRisk) {
                    languageClient.dependencyRiskInvestigatedLocally();
                    languageClient.openDependencyRiskInBrowser(finding.fileUri, finding.key);
                }
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.TRIGGER_RESOLVE_TAINT_COMMAND,
            (finding: FindingNode) => {
                const fileUri = finding.fileUri;
                const workspaceUri = coc.workspace.getWorkspaceFolder(coc.Uri.parse(fileUri))?.uri;
                const issueKey = finding.serverIssueKey;
                const isTaintIssue = true;

                coc.commands.executeCommand(Commands.RESOLVE_ISSUE, workspaceUri, issueKey, fileUri, isTaintIssue);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            Commands.TRIGGER_FETCH_CODE_ACTIONS_COMMAND,
            async (finding: FindingNode) => {
                const codeActions = await coc.commands.executeCommand<coc.CodeAction[]>(
                    // TODO: what is this for
                    "vscode.executeCodeActionProvider",
                    coc.Uri.parse(finding.fileUri),
                    finding.range,
                    coc.CodeActionKind.QuickFix
                );
                const codeActionsFromSonarQube = codeActions.filter((action) => action.title.startsWith("SonarQube: "));
                await selectAndApplyCodeAction(codeActionsFromSonarQube);
            },
            undefined,
            true
        )
    );

    context.subscriptions.push(
        coc.commands.registerCommand(
            "SonarLint.NewCodeDefinition.Enable",
            () => {
                coc.workspace.getConfiguration("sonarlint").update("focusOnNewCode", true, coc.ConfigurationTarget.Global);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            "SonarLint.NewCodeDefinition.Disable",
            () => {
                coc.workspace.getConfiguration("sonarlint").update("focusOnNewCode", false, coc.ConfigurationTarget.Global);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            "SonarLint.AutomaticAnalysis.Enable",
            () => {
                coc.workspace.getConfiguration("sonarlint").update("automaticAnalysis", true, coc.ConfigurationTarget.Global);
            },
            undefined,
            true
        ),
        coc.commands.registerCommand(
            "SonarLint.AutomaticAnalysis.Disable",
            () => {
                coc.workspace.getConfiguration("sonarlint").update("automaticAnalysis", false, coc.ConfigurationTarget.Global);
            },
            undefined,
            true
        )
    );

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.OPEN_SONARQUBE_RULES_FILE, () => openSonarQubeRulesFile()),
        coc.commands.registerCommand(Commands.OPEN_MCP_SERVER_CONFIGURATION, () => openMCPServerConfigurationFile()),
        coc.commands.registerCommand(
            Commands.SHOW_MCP_CONFIGURATIONS,
            async () => await util.showTargetView(aiAgentsConfigurationView, "MCP Configurations")
        ),
        coc.commands.registerCommand(Commands.INTRODUCE_SONARQUBE_RULES_FILE, () => introduceSonarQubeRulesFile(languageClient)),
        coc.commands.registerCommand(
            Commands.REFRESH_AI_AGENTS_CONFIGURATION,
            () => aiAgentsConfigurationTreeDataProvider.refresh(),
            undefined,
            true
        )
    );
}

async function scanFolderForHotspotsCommandHandler(folderUri: coc.Uri) {
    await useProvidedFolderOrPickManuallyAndScan(
        folderUri,
        coc.workspace.workspaceFolders,
        languageClient,
        getFilesForHotspotsAndLaunchScan
    );
}

function installCustomRequestHandlers(context: coc.ExtensionContext) {
    context.subscriptions.push(
        languageClient.onNotification(ExtendedClient.ShowIssueNotification.type, async (issue: ExtendedClient.Issue) => {
            await IssueService.showIssue(issue);
        })
    );
    context.subscriptions.push(
        languageClient.onNotification(
            ExtendedClient.StartProgressNotification.type,
            (params: ExtendedClient.StartProgressNotificationParams) => {
                const taskId = params.taskId;
                if (currentProgress[taskId]) {
                    // If there's an existing progress, resolve it first
                    currentProgress[taskId].resolve();
                }

                coc.window.withProgress(
                    {
                        title: "Sonarlint",
                        cancellable: false
                    },
                    (progress) => {
                        return new Promise<void>((resolve) => {
                            currentProgress[taskId] = { progress, resolve };
                            if (params.message) {
                                progress.report({ message: params.message });
                            }
                        });
                    }
                );
            }
        )
    );
    context.subscriptions.push(
        languageClient.onNotification(
            ExtendedClient.EndProgressNotification.type,
            (params: ExtendedClient.EndProgressNotificationParams) => {
                const taskId = params.taskId;
                if (currentProgress[taskId]) {
                    currentProgress[taskId].resolve();
                    currentProgress[taskId] = undefined;
                }
            }
        )
    );
    languageClient.onNotification(ExtendedClient.ShowFixSuggestion.type, (params: ExtendedClient.ShowFixSuggestionParams) =>
        FixSuggestionService.instance.showFixSuggestion(params)
    );
    languageClient.onNotification(ExtendedClient.ShowRuleDescriptionNotification.type, showRuleDescription(floatDescriptionFactory));
    languageClient.onNotification(ExtendedClient.SuggestBindingNotification.type, (params: ExtendedClient.SuggestBindingParams) =>
        suggestBinding(params)
    );
    languageClient.onRequest(ExtendedClient.ListFilesInFolderRequest.type, async (params: any) => {
        await FileSystemServiceImpl.instance.crawlDirectory(coc.Uri.parse(params.folderUri));
        return AutoBindingService.instance.listAutobindingFilesInFolder(params);
    });
    languageClient.onRequest(ExtendedClient.GetTokenForServer.type, (serverId: string) => getTokenForServer(serverId));

    languageClient.onRequest(
        ExtendedClient.GetJavaConfigRequest.type,
        async (fileUri: string) => await getJavaConfig(languageClient, fileUri)
    );
    languageClient.onRequest(ExtendedClient.ShouldAnalyseFileCheck.type, (params: any) => shouldAnalyseFile(params.uri));
    languageClient.onRequest(ExtendedClient.FilterOutExcludedFiles.type, (params: any) =>
        filterOutFilesIgnoredForAnalysis(params.fileUris)
    );
    languageClient.onRequest(ExtendedClient.CanShowMissingRequirementNotification.type, () => {
        return context.globalState.get(CAN_SHOW_MISSING_REQUIREMENT_NOTIF, true);
    });
    languageClient.onNotification(ExtendedClient.DoNotShowMissingRequirementsMessageAgain.type, () => {
        context.globalState.update(CAN_SHOW_MISSING_REQUIREMENT_NOTIF, false);
    });
    languageClient.onNotification(ExtendedClient.MaybeShowWiderLanguageSupportNotification.type, (languages: string[]) =>
        maybeShowWiderLanguageSupportNotification(context, languages)
    );
    languageClient.onNotification(ExtendedClient.RemoveBindingsForDeletedConnections.type, async (connectionIds: string[]) => {
        await BindingService.instance.removeBindingsForRemovedConnections(connectionIds);
    });
    languageClient.onNotification(ExtendedClient.ReportConnectionCheckResult.type, (checkResult: ConnectionCheckResult) => {
        ConnectionSettingsService.instance.reportConnectionCheckResult(checkResult);
        allConnectionsTreeDataProvider.reportConnectionCheckResult(checkResult);
        if (checkResult.success) {
            coc.window.showInformationMessage(`Connection for sonar qube/cloud with id '${checkResult.connectionId}' was successful!`);
        } else {
            coc.window.showErrorMessage(
                `Connection with id '${checkResult.connectionId}' failed, due to ${checkResult.reason}. Please check your settings.`
            );
        }
    });
    languageClient.onNotification(ExtendedClient.ShowNotificationForFirstSecretsIssueNotification.type, () =>
        showNotificationForFirstSecretsIssue(context)
    );
    languageClient.onNotification(ExtendedClient.ShowSonarLintOutputNotification.type, () =>
        coc.commands.executeCommand(Commands.SHOW_SONARLINT_OUTPUT)
    );
    languageClient.onNotification(ExtendedClient.OpenJavaHomeSettingsNotification.type, () =>
        coc.commands.executeCommand(Commands.OPEN_SETTINGS, JAVA_HOME_CONFIG)
    );
    languageClient.onNotification(ExtendedClient.OpenPathToNodeSettingsNotification.type, () =>
        coc.commands.executeCommand(Commands.OPEN_SETTINGS, "sonarlint.pathToNodeExecutable")
    );
    languageClient.onNotification(ExtendedClient.BrowseToNotification.type, (browseTo: string) =>
        coc.commands.executeCommand(Commands.OPEN_BROWSER, browseTo)
    );
    languageClient.onNotification(ExtendedClient.OpenConnectionSettingsNotification.type, (isSonarCloud: boolean) => {
        const targetSection = `sonarlint.connectedMode.connections.${isSonarCloud ? "sonarcloud" : "sonarqube"}`;
        return coc.commands.executeCommand(Commands.OPEN_SETTINGS, targetSection);
    });
    languageClient.onNotification(ExtendedClient.ShowHotspotNotification.type, (h: ExtendedClient.RemoteHotspot) =>
        showSecurityHotspot(findingsView, findingsTreeDataProvider, h)
    );
    languageClient.onNotification(ExtendedClient.ShowIssueOrHotspotNotification.type, showAllLocations);
    languageClient.onNotification(ExtendedClient.NeedCompilationDatabaseRequest.type, notifyMissingCompileCommands(context));
    languageClient.onRequest(ExtendedClient.GetTokenForServer.type, (serverId: string) => getTokenForServer(serverId));
    languageClient.onNotification(
        ExtendedClient.PublishHotspotsForFile.type,
        async (hotspotsPerFile: ExtendedClient.PublishDiagnosticsParams) => {
            findingsTreeDataProvider.updateHotspots(hotspotsPerFile);
        }
    );
    languageClient.onNotification(ExtendedClient.PublishTaintVulnerabilitiesForFile.type, async (taintVulnerabilitiesPerFile: any) => {
        findingsTreeDataProvider.updateTaintVulnerabilities(taintVulnerabilitiesPerFile.uri, taintVulnerabilitiesPerFile.diagnostics);
    });
    languageClient.onNotification(ExtendedClient.NotifyInvalidToken.type, async (params: any) => {
        const isSonarQube =
            ConnectionSettingsService.instance.getSonarQubeConnections()?.findIndex((c) => c.connectionId === params.connectionId) !== -1;
        const isSonarCloud =
            ConnectionSettingsService.instance.getSonarCloudConnections()?.findIndex((c) => c.connectionId === params.connectionId) !== -1;
        if (!isSonarCloud && !isSonarQube) {
            return;
        }
        await coc.window.showErrorMessage(`Connection to '${params.connectionId}' failed: Please verify your token.`);
    });

    languageClient.onNotification(
        ExtendedClient.PublishDependencyRisksForFolder.type,
        async (dependencyRisksPerFolder: ExtendedClient.PublishDiagnosticsParams) => {
            findingsTreeDataProvider.updateDependencyRisks(dependencyRisksPerFolder);
        }
    );

    languageClient.onRequest(
        ExtendedClient.AssistBinding.type,
        async (params: ExtendedClient.AssistBindingParams) => await BindingService.instance.assistBinding(params)
    );
    languageClient.onRequest(ExtendedClient.SslCertificateConfirmation.type, (cert: ExtendedClient.SslCertificateConfirmationParams) =>
        showSslCertificateConfirmationDialog(cert)
    );
    languageClient.onRequest(ExtendedClient.AssistCreatingConnection.type, assistCreatingConnection(context));
    languageClient.onNotification(
        ExtendedClient.ShowSoonUnsupportedVersionMessage.type,
        (params: ExtendedClient.ShowSoonUnsupportedVersionMessageParams) =>
            showSoonUnsupportedVersionMessage(params, context.workspaceState)
    );
    languageClient.onNotification(
        ExtendedClient.SubmitNewCodeDefinition.type,
        (newCodeDefinitionForFolderUri: ExtendedClient.SubmitNewCodeDefinitionParams) => {
            NewCodeDefinitionService.instance.updateNewCodeDefinitionForFolderUri(newCodeDefinitionForFolderUri);
        }
    );
    languageClient.onNotification(ExtendedClient.SuggestConnection.type, (params: any) =>
        SharedConnectedModeSettingsService.instance.handleSuggestConnectionNotification(params.suggestionsByConfigScopeId)
    );
    languageClient.onNotification(ExtendedClient.EmbeddedServerStartedNotification.type, (params: any) => {
        onEmbeddedServerStarted(params.port);
    });
    languageClient.onRequest(ExtendedClient.IsOpenInEditor.type, (fileUri) => util.isOpenInEditor(fileUri));
}

function updateFindingsViewContainerBadge() {
    const totalCount = findingsTreeDataProvider.getTotalFindingsCount();
    const activeFilter = findingsTreeDataProvider.getActiveFilter();

    if (totalCount > 0) {
        const filterDisplayName = getFilterDisplayName(activeFilter);
        findingsView.title = `Findings (${filterDisplayName})`;
    } else {
        findingsView.title = "Findings";
    }
}

async function getTokenForServer(serverId: string): Promise<string | undefined> {
    // serverId is either a server URL or a organizationKey prefixed with region (EU_ or US_)
    return ConnectionSettingsService.instance.getServerToken(serverId);
}

async function showAllLocations(issue: ExtendedClient.Issue) {
    await secondaryLocationTreeDataProvider.showAllLocations(issue);
    if (issue.creationDate) {
        const createdAgo = issue.creationDate ? DateTime.fromISO(issue.creationDate).toLocaleString(DateTime.DATETIME_MED) : null;
        issueLocationsView.message = createdAgo ? `Analyzed ${createdAgo} on '${issue.connectionId}'` : `Detected by Sonarlint `;
    } else {
        issueLocationsView.message = undefined;
    }
    if (issue.flows.length > 0) {
        // make sure the view is visible
        const elements: coc.ProviderResult<LocationTreeItem[]> | undefined = secondaryLocationTreeDataProvider.getChildren();
        if (elements && elements !== undefined) {
            await util.showTargetView(issueLocationsView, "Locations");
            await issueLocationsView.reveal(elements[0]);
        }
    }
}

function clearLocations() {
    secondaryLocationTreeDataProvider.hideLocations();
    issueLocationsView.message = undefined;
}

export function deactivate(): coc.Thenable<void> {
    if (!languageClient) {
        Promise.resolve();
    }
    return languageClient.stop();
}
