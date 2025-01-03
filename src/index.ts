/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */import Path from "path"
import * as FS from 'fs'
import * as path from 'path'
import * as util from "./util/util"
import * as protocol from "./lsp/protocol"
import * as ChildProcess from "child_process"
import type {Position, Location} from "vscode-languageserver-types"
import {ExtensionContext, StreamInfo, nvim, window} from "coc.nvim"
import * as coc from "coc.nvim"
import {
    updateVerboseLogging,
    isVerboseEnabled,
    isNotificationEnabled
} from "./settings/settings"
import {
    getLogOutput,
    initLogOutput,
    logToSonarLintOutput,
    showLogOutput,
} from "./util/logging"
import {setExtensionContext} from "./util/util"
import {languageServerCommand} from "./lsp/server"
import {JAVA_HOME_CONFIG, installManagedJre, resolveRequirements} from "./util/requirements"
import {SonarLintExtendedLanguageClient} from "./lsp/client"
import {getPlatform} from "./util/platform"
import {Commands} from "./util/commands"
import {
    AllRulesTreeDataProvider,
    LanguageNode,
    RuleNode,
    languageKeyDeNormalization,
    toggleRule,
} from "./rules/rules"
import {getJavaConfig, installClasspathListener} from "./java/java"
import {showRuleDescription} from "./rules/rulepanel"
import {
    configureCompilationDatabase,
    notifyMissingCompileCommands,
} from "./cfamily/cfamily"
import {showSslCertificateConfirmationDialog} from "coc-sonarlint/src/util/showMessage"
import {ConnectionSettingsService} from "coc-sonarlint/src/settings/connectionsettings"

const DOCUMENT_SELECTOR = [
    {
        scheme: "file",
        pattern: "**/*",
    },
    {
        notebook: {
            scheme: "file",
            notebookType: "jupyter-notebook",
        },
        language: "python",
    },
]

let languageClient: SonarLintExtendedLanguageClient
let connectionSettingsService: ConnectionSettingsService
let allRulesTreeDataProvider: AllRulesTreeDataProvider
let allRulesView: coc.TreeView<LanguageNode>
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
                const {command, args}: any = languageServerCommand(context, requirements)
                if (!command) {
                    reject(new Error("Failed to resolve launch command and args"))
                    return
                }
                logToSonarLintOutput(`Executing ${command} ${args.join(" ")}`)
                const process = ChildProcess.spawn(command, args)

                process.stderr.on("data", function (data) {
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
                productName: "SonarLint",
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
    connectionSettingsService = new ConnectionSettingsService(languageClient);

    await languageClient.start()
    coc.services.registerLanguageClient(languageClient)

    allRulesTreeDataProvider = new AllRulesTreeDataProvider(
        () => languageClient.listAllRules(),
        new Map(),
    )
    allRulesView = coc.window.createTreeView("Sonarlint rules", {
        bufhidden: 'hide',
        treeDataProvider: allRulesTreeDataProvider,
    })
    allRulesView.onDidCollapseElement((n) => {
        allRulesTreeDataProvider.register(n.element)
    })
    allRulesView.onDidExpandElement((n) => {
        allRulesTreeDataProvider.register(n.element)
    })
    context.subscriptions.push(allRulesView)

    floatDescriptionFactory = window.createFloatFactory({
        preferTop: true,
        autoHide: true,
        modes: ["n"],
    })
    context.subscriptions.push(floatDescriptionFactory)
    installCustomRequestHandlers()

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
            await showRulesView("Sonarlint all rules")
        }),
    )
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.SHOW_ACTIVE_RULES, async () => {
            allRulesTreeDataProvider.filter("on")
            await showRulesView("Sonarlint active rules")
        }),
    )
    context.subscriptions.push(
        coc.commands.registerCommand(Commands.SHOW_INACTIVE_RULES, async () => {
            allRulesTreeDataProvider.filter("off")
            await showRulesView("Sonarlint inactive rules")
        }),
    )

    context.subscriptions.push(
        coc.commands.registerCommand(
            Commands.OPEN_RULE_BY_KEY,
            async (ruleKey: string) => {
                if (!ruleKey || ruleKey.length == 0) {
                    coc.window.showWarningMessage(`Provided rule key was emtpy or was invalid`)
                    return
                }
                allRulesTreeDataProvider.filter()
                await showRulesView(`Sonarlint rules for rule ${ruleKey}`)
                const indexOfSeparator = ruleKey.indexOf(":")
                const language = indexOfSeparator > 0 ? ruleKey.substring(0, indexOfSeparator) : null
                const type = indexOfSeparator > 0 && language
                    ? new RuleNode({key: languageKeyDeNormalization(language) + ":" + ruleKey.substring(indexOfSeparator + 1).toLowerCase()} as protocol.Rule, language)
                    : new LanguageNode(ruleKey, coc.TreeItemCollapsibleState.Collapsed)
                let node = await allRulesTreeDataProvider.getTreeItem(type)
                if (type instanceof RuleNode && language) {
                    const pnode = new LanguageNode(language.toLowerCase(), coc.TreeItemCollapsibleState.Expanded)
                    allRulesTreeDataProvider.register(pnode)
                    if (node === type) {
                        await allRulesTreeDataProvider.getChildren(pnode)
                        node = await allRulesTreeDataProvider.getTreeItem(type)
                    }
                    await allRulesView?.reveal(node, {select: true, focus: true, expand: true})
                } else if (type instanceof LanguageNode) {
                    node.collapsibleState = coc.TreeItemCollapsibleState.Expanded
                    allRulesTreeDataProvider.register(node)
                    await allRulesView?.reveal(node, {select: true, focus: true, expand: true})
                } else {
                    coc.window.showWarningMessage(`Unable to find or resolve rule id ${ruleKey}`)
                }
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
            () => void configureCompilationDatabase(),
        ),
    )

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.ENABLE_VERBOSE_LOGS, () => updateVerboseLogging(true))
    )

    context.subscriptions.push(
        coc.commands.registerCommand(Commands.INSTALL_MANAGED_JRE, () => {
            installManagedJre(context, function () {
                coc.window
                    .showInformationMessage(`Downloaded & installed a managed jre`)
            }, function () {
                coc.window
                    .showErrorMessage(`Unable to download managed jre`)
            })
        })
    )

}

function installCustomRequestHandlers() {
    languageClient.onNotification(
        protocol.ShowRuleDescriptionNotification.type,
        showRuleDescription(floatDescriptionFactory),
    )
    languageClient.onRequest(protocol.ListFilesInFolderRequest.type, (params: protocol.FolderUriParams) => {
        const files: any[] = []
        const ignored: string[] = coc.workspace
            .getConfiguration()
            .get<string[]>("sonarlint.listFilesFoldersExclusions", [])

        const folderCrawler = (dir: string) => {
            let elements: string[] = []
            try {
                elements = FS.readdirSync(dir)
            } catch (error) {
                logToSonarLintOutput(`Failed to read dir ${dir} due to ${error}`)
            }
            for (const elem of elements) {
                try {
                    const full = path.join(dir, elem)
                    const stat = FS.statSync(full)
                    if (stat.isFile()) {
                        files.push({
                            filePath: full,
                            fileName: elem
                        })
                    } else if (!ignored.includes(elem)) {
                        folderCrawler(full)
                    }
                } catch (error) {
                    logToSonarLintOutput(`Failed to stat ${elem} due to ${error}`)
                }
            }
        }
        folderCrawler(coc.Uri.parse(params.folderUri).fsPath)
        return {foundFiles: files}
    })
    languageClient.onRequest(protocol.GetJavaConfigRequest.type, (params) =>
        getJavaConfig(languageClient, params),
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
    languageClient.onRequest(protocol.isOpenInEditor.type, (fileUri) =>
        util.isOpenInEditor(fileUri),
    )
    languageClient.onRequest(protocol.SslCertificateConfirmation.type, cert =>
        showSslCertificateConfirmationDialog(cert)
    );
    languageClient.onRequest(protocol.GetTokenForServer.type, serverId =>
        connectionSettingsService.getServerToken(serverId),
    );
    languageClient.onNotification(protocol.ReportConnectionCheckResult.type, result => {
        connectionSettingsService.reportConnectionCheckResult(result);
        if (result.success) {
            coc.window.showInformationMessage(`Connection for sonar qube/cloud with id '${result.connectionId}' was successful!`);
        } else {
            coc.window.showErrorMessage(`Connection with id '${result.connectionId}' failed, due to ${result.reason}. Please check your settings.`);
        }
    });
    languageClient.onRequest(
        protocol.CanShowMissingRequirementNotification.type, () => {return true})
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

    if (isNotificationEnabled() !== false) {
        languageClient.onNotification(
            protocol.NeedCompilationDatabaseRequest.type,
            notifyMissingCompileCommands(),
        )
    }
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
            locations.push({uri: loc.uri, range: range} as Location)
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

export async function showRulesView(title: string) {
    allRulesView.title = title
    if (allRulesView?.visible) {
        const winId = allRulesView.windowId
        const tabnr = await nvim.call('tabpagenr') as number
        const buflist = await nvim.call('tabpagebuflist', [tabnr]) as number[]
        const bufId = await nvim.call('winbufnr', [winId])
        const found = buflist.find((bufnr) => {return bufId == bufnr})
        if (!found) {
            await nvim.call('coc#window#close', [winId])
            await allRulesView?.show('botright 10split')
        }
    } else if (!allRulesView?.visible) {
        await allRulesView?.show('botright 10split')
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

