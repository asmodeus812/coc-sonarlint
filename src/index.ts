/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */import Path from "path"
import * as util from "./util/util"
import * as protocol from "./lsp/protocol"
import * as ChildProcess from "child_process"
import type { Position, Location } from "vscode-languageserver-types"
import { ExtensionContext, StreamInfo, window } from "coc.nvim"
import * as coc from "coc.nvim"
import {
    enableVerboseLogs,
    isVerboseEnabled,
    loadInitialSettings,
} from "./settings/settings"
import {
    getLogOutput,
    initLogOutput,
    logToSonarLintOutput,
    showLogOutput,
} from "./util/logging"
import { setExtensionContext } from "./util/util"
import { languageServerCommand } from "./lsp/server"
import { JAVA_HOME_CONFIG, resolveRequirements } from "./util/requirements"
import { SonarLintExtendedLanguageClient } from "./lsp/client"
import { getPlatform } from "./util/platform"
import { Commands } from "./util/commands"
import {
    AllRulesTreeDataProvider,
    LanguageNode,
    RuleNode,
    toggleRule,
} from "./rules/rules"
import { getJavaConfig, installClasspathListener } from "./java/java"
import { showRuleDescription } from "./rules/rulepanel"
import {
    configureCompilationDatabase,
    notifyMissingCompileCommands,
} from "./cfamily/cfamily"

const DOCUMENT_SELECTOR = [
    { scheme: "file", pattern: "**/*" },
    {
        notebook: {
            scheme: "file",
            notebookType: "jupyter-notebook",
        },
        language: "python",
    },
]

let languageClient: SonarLintExtendedLanguageClient
let allRulesTreeDataProvider: AllRulesTreeDataProvider
let allRulesView: coc.TreeView<LanguageNode> | undefined
let floatDescriptionFactory: coc.FloatFactory

async function runJavaServer(
    context: coc.ExtensionContext,
): Promise<StreamInfo> {
    return resolveRequirements(context)
        .catch((error) => {
            //show error
            coc.window
                .showErrorMessage(error.message, error.label)
                .then((selection) => {
                    if (error.label && error.label === selection && error.command) {
                        coc.commands.executeCommand(error.command, error.commandParam)
                    }
                })
            // rethrow to disrupt the chain.
            throw error
        })
        .then((requirements) => {
            return new Promise<StreamInfo>((resolve, reject) => {
                const { command, args }: any = languageServerCommand(context, requirements)
                if (!command) {
                    reject(new Error("Failed to resolve launch command and args"))
                    return
                }
                logToSonarLintOutput(`Executing ${command} ${args.join(" ")}`)
                const process = ChildProcess.spawn(command, args)

                process.stderr.on("data", function(data) {
                    logWithPrefix(data, "[stderr]")
                })

                resolve({
                    reader: process.stdout,
                    writer: process.stdin,
                })
            })
        })
}

export async function activate(context: ExtensionContext): Promise<void> {

    loadInitialSettings()
    setExtensionContext(context)
    initLogOutput(context)

    const serverOptions = () => runJavaServer(context)

    const pythonWatcher = coc.workspace.createFileSystemWatcher("**/*.py")
    const sharedConnectedModeConfigurationWatcher =
        coc.workspace.createFileSystemWatcher("**/.sonarlint/*.json")
    context.subscriptions.push(pythonWatcher)
    context.subscriptions.push(sharedConnectedModeConfigurationWatcher)

    // Options to control the language client
    const clientOptions: coc.LanguageClientOptions = {
        documentSelector: DOCUMENT_SELECTOR,
        synchronize: {
            configurationSection: "sonarlint",
            fileEvents: [pythonWatcher, sharedConnectedModeConfigurationWatcher],
        },
        diagnosticCollectionName: "sonarlint",
        initializationOptions: () => {
            return {
                productKey: "vscode",
                productName: "SonarLint coc",
                productVersion: "1.0.0",
                showVerboseLogs: coc.workspace
                    .getConfiguration()
                    .get("sonarlint.output.showVerboseLogs", false),
                platform: getPlatform(),
                architecture: process.arch,
                clientNodePath: coc.workspace
                    .getConfiguration()
                    .get("sonarlint.pathToNodeExecutable"),
            }
        },
        outputChannel: getLogOutput(),
        revealOutputChannelOn: 4, // never
    }

    languageClient = new SonarLintExtendedLanguageClient(
        "sonarlint",
        "SonarLint Language Server",
        serverOptions,
        clientOptions,
    )

    await languageClient.start()

    allRulesTreeDataProvider = new AllRulesTreeDataProvider(
        () => languageClient.listAllRules(),
        new Map(),
    )

    floatDescriptionFactory = window.createFloatFactory({
        preferTop: true,
        autoHide: true,
        modes: ["n"],
    })
    context.subscriptions.push(floatDescriptionFactory)

    installCustomRequestHandlers(context)

    coc.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration("sonarlint.rules")) {
            allRulesTreeDataProvider.refresh()
        }
    })

    registerCommands(context)

    context.subscriptions.push(
        coc.extensions.onDidActiveExtension(() => {
            installClasspathListener(languageClient)
        }),
    )
    installClasspathListener(languageClient)
}

function registerCommands(context: coc.ExtensionContext) {
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.SHOW_ALL_LOCATIONS, showAllLocations),
    )
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.CLEAR_LOCATIONS, clearLocations),
    )

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.DEACTIVATE_RULE, toggleRule("off")),
    )
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.ACTIVATE_RULE, toggleRule("on")),
    )
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.TOGGLE_RULE, toggleRule()),
    )

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.SHOW_ALL_RULES, async () => {
            allRulesTreeDataProvider.filter()
            await prepareRulesTreeView("Displaying all rules")
        }),
    )
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.SHOW_ACTIVE_RULES, async () => {
            allRulesTreeDataProvider.filter("on")
            await prepareRulesTreeView("Displaying active rules")
        }),
    )
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.SHOW_INACTIVE_RULES, async () => {
            allRulesTreeDataProvider.filter("off")
            await prepareRulesTreeView("Displaying inactive rules")
        }),
    )

    context.subscriptions.push(
        coc.commands.registerCommand(
            Commands.OPEN_RULE_BY_KEY,
            async (ruleKey: string) => {
                await prepareRulesTreeView(`Displaying rules for ${ruleKey}`)
                const type = ruleKey.indexOf(":") >= 0
                    ? new RuleNode({ key: ruleKey.toLowerCase() } as protocol.Rule)
                    : new LanguageNode(ruleKey.toLowerCase(), coc.TreeItemCollapsibleState.Collapsed)
                const node = await allRulesTreeDataProvider.getTreeItem(type)
                node.collapsibleState = coc.TreeItemCollapsibleState.Expanded
                allRulesTreeDataProvider.register(node)
                await allRulesView?.reveal(node, { select: true, focus: true, expand: true })
            },
        ),
    )

    context.subscriptions.push(
        coc.commands.registerCommand(
            Commands.SHOW_HOTSPOT_RULE_DESCRIPTION,
            (hotspot) =>
                languageClient.showHotspotRuleDescription(
                    hotspot.ruleKey,
                    hotspot.key,
                    hotspot.fileUri,
                ),
        ),
    )

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.FIND_RULE_BY_KEY, async () => {
            const key = await coc.window.requestInput("Enter rule key", "")
            await coc.commands.executeCommand(Commands.OPEN_RULE_BY_KEY, key)
        }),
    )
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.SHOW_SONARLINT_OUTPUT, () =>
            showLogOutput(),
        ),
    )

    context.subscriptions.push(
        coc.commands.registerCommand(
            Commands.CONFIGURE_COMPILATION_DATABASE,
            configureCompilationDatabase,
        ),
    )

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.ENABLE_VERBOSE_LOGS, () =>
            enableVerboseLogs(),
        ),
    )
}

function installCustomRequestHandlers(context: coc.ExtensionContext) {
    languageClient.onNotification(
        protocol.ShowRuleDescriptionNotification.type,
        showRuleDescription(floatDescriptionFactory),
    )
    languageClient.onRequest(protocol.GetJavaConfigRequest.type, (fileUri) =>
        getJavaConfig(languageClient, fileUri),
    )
    languageClient.onRequest(protocol.ScmCheckRequest.type, (params) =>
        util.shouldIgnoreBySourceControl(params),
    )
    languageClient.onRequest(protocol.FilterOutExcludedFiles.type, (params) =>
        util.filterOutFilesIgnoredForAnalysis(params.fileUris),
    )
    languageClient.onRequest(protocol.ShouldAnalyseFileCheck.type, (params) =>
        util.shouldAnalyseFile(params.uri),
    )
    languageClient.onRequest(
        protocol.CanShowMissingRequirementNotification.type, () => { return true })
    languageClient.onNotification(
        protocol.ShowSonarLintOutputNotification.type,
        () => void coc.commands.executeCommand(Commands.SHOW_SONARLINT_OUTPUT),
    )
    languageClient.onNotification(
        protocol.OpenJavaHomeSettingsNotification.type,
        () => void coc.commands.executeCommand(Commands.OPEN_SETTINGS, JAVA_HOME_CONFIG),
    )
    languageClient.onNotification(
        protocol.OpenPathToNodeSettingsNotification.type,
        () => void coc.commands.executeCommand(
            Commands.OPEN_SETTINGS,
            "sonarlint.pathToNodeExecutable",
        ),
    )
    languageClient.onNotification(
        protocol.BrowseToNotification.type,
        (browseTo) => void coc.commands.executeCommand(
            Commands.OPEN_BROWSER,
            coc.Uri.parse(browseTo),
        ),
    )
    languageClient.onNotification(
        protocol.NeedCompilationDatabaseRequest.type,
        notifyMissingCompileCommands(context),
    )
}

async function showAllLocations(issue: protocol.Issue) {
    const locations: Location[] = []
    issue.flows.forEach((flow) =>
        flow.locations.forEach((loc) => {
            const textRange = loc.textRange
            const range = {
                start: {
                    line: textRange.startLine,
                    character: textRange.startLineOffset,
                } as Position,
                end: {
                    line: textRange.endLine,
                    character: textRange.endLineOffset,
                } as Position,
            }
            locations.push({ uri: loc.uri, range: range } as Location)
        }),
    )

    const quickFixList = await coc.workspace.getQuickfixList(locations)
    await coc.nvim.call("setqflist", [quickFixList])

    let openCommand = (await coc.nvim.getVar(
        "coc_quickfix_open_command",
    )) as string
    coc.nvim.command(
        typeof openCommand === "string" ? openCommand : "copen",
        true,
    )
}

async function clearLocations() {
    await coc.nvim.call("setqflist", [[], "r"])
}

export function deactivate(): Thenable<void> | undefined {
    if (!languageClient) {
        return undefined
    }
    return languageClient.stop()
}

export async function prepareRulesTreeView(title: string) {
    if (!allRulesView) {
        allRulesView = coc.window.createTreeView(title, {
            treeDataProvider: allRulesTreeDataProvider,
        })
        allRulesView.onDidCollapseElement((n) => {
            allRulesTreeDataProvider.register(n.element)
        })
        allRulesView.onDidExpandElement((n) => {
            allRulesTreeDataProvider.register(n.element)
        })
        allRulesView.onDidChangeVisibility((e) => {
            if (!e.visible) {
                allRulesView?.dispose()
                allRulesView = undefined
            }
        })
    }
    allRulesView.title = title
    if (!allRulesView.visible) {
        await allRulesView?.show()
    }
}

function logWithPrefix(data: string, prefix: string) {
    if (isVerboseEnabled()) {
        const lines: string[] = data.toString().split(/\r\n|\r|\n/)
        lines.forEach((l: string) => {
            if (l.length > 0) {
                logToSonarLintOutput(`${prefix} ${l}`)
            }
        })
    }
}

export function toUrl(filePath: string) {
    let pathName: string = Path.resolve(filePath).replace(/\\/g, "/")

    // Windows drive letter must be prefixed with a slash
    if (!pathName.startsWith("/")) {
        pathName = "/" + pathName
    }

    return encodeURI("file://" + pathName)
}
