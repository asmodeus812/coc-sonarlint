/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict"

import * as coc from "coc.nvim"
import { ConfigLevel, Rule, RulesResponse } from "../lsp/protocol"
import { getSonarLintConfiguration } from "../settings/settings"
import { Commands } from "../util/commands"
import { logToSonarLintOutput } from 'coc-sonarlint/src/util/logging'

function isActive(rule: Rule) {
    return (
        (rule.activeByDefault && rule.levelFromConfig !== "off") ||
        rule.levelFromConfig === "on"
    )
}

function actualLevel(rule: Rule) {
    return isActive(rule) ? "on" : "off"
}

export class LanguageNode extends coc.TreeItem {
    constructor(label: string, state: coc.TreeItemCollapsibleState) {
        super(label, state)
        this.id = label.toLowerCase()
        this.tooltip = `Rules applicable for ${label} language`
    }
}

export class RuleNode extends coc.TreeItem {
    constructor(public readonly rule: Rule, public readonly language?: string) {
        super(rule.name)
        this.id = rule.key.toLowerCase()
        this.tooltip = `Toggle rule ${rule.key} status`
        this.description = `${rule.key} - ${actualLevel(rule)}`
        this.command = {
            command: "SonarLint.ToggleRule",
            title: "Toggle current rule",
            arguments: [rule],
        }
    }
}

export type AllRulesNode = LanguageNode | RuleNode

export class AllRulesTreeDataProvider
    implements coc.TreeDataProvider<AllRulesNode> {
    private readonly _onDidChangeTreeData = new coc.Emitter<
        AllRulesNode | undefined
    >();
    readonly onDidChangeTreeData: coc.Event<AllRulesNode | undefined> =
        this._onDidChangeTreeData.event;
    private levelFilter?: ConfigLevel
    private allRules: RulesResponse | undefined
    private allRoots: AllRulesNode[] = []
    private allChildren: Map<string, RuleNode[]> = new Map()

    constructor(
        private readonly allRulesProvider: () => Thenable<RulesResponse>,
        private readonly allRootsStates: Map<
            string | coc.TreeItemLabel | undefined,
            coc.TreeItemCollapsibleState | undefined
        >,
    ) {}

    public async getTreeItem(node: AllRulesNode) {
        if (node instanceof RuleNode && node.id && this.allChildren.has(node.id)) {
            return this.allChildren.get(node.id)?.find(n => n.id == node.id) as RuleNode
        } else if (node instanceof LanguageNode && this.allRoots.length > 0) {
            return this.allRoots?.find(n => n.id == node.id) as LanguageNode
        } else {
            return node
        }
    }

    public async getParent(node: AllRulesNode) {
        if (node instanceof LanguageNode) {
            return null
        } else if (node instanceof RuleNode) {
            if (this.allRoots.length == 0) {
                await this.getChildren()
            }
            if (node?.language !== undefined) {
                return this.allRoots.find(n => n.id == node.language) as LanguageNode
            } else {
                const response = await this.getAllRules()
                const nodeKey = node.rule.key.toLowerCase()
                const languageNode = Object.keys(response)
                    .filter((k) => response[k].findIndex(
                        (r) => r.key.toLowerCase() === nodeKey) >= 0)
                    .map(l => l.toLowerCase())
                    .pop()
                return this.allRoots.find(n => n.id == languageNode) as LanguageNode
            }
        }
    }

    public async getChildren(node?: AllRulesNode) {
        let result: AllRulesNode[] | undefined
        if (this.allRoots.length == 0 || (node?.id && !this.allChildren.has(node.id))) {
            const localRuleConfig = coc.workspace.getConfiguration("sonarlint.rules")
            result = await this.getAllRules()
                .then((response) => {
                    if (node) {
                        // Render rules under language nodes
                        return response[node.label as string]
                            .sort(byName)
                            .map((rule) => {
                                rule.levelFromConfig = localRuleConfig.get(rule.key, {})["level"]
                                return rule
                            })
                            .filter((r) => {
                                if (this.levelFilter === "on") {
                                    return isActive(r)
                                } else if (this.levelFilter === "off") {
                                    return !isActive(r)
                                } else {
                                    return true
                                }
                            })
                            .map((rule) => new RuleNode(rule, node.id?.toLowerCase()))
                    } else {
                        // Roots are language nodes
                        return Object.keys(response)
                            .sort()
                            .map(
                                (language) =>
                                    new LanguageNode(language, this.allRootsStates.get(language.toLowerCase()) || coc.TreeItemCollapsibleState.Collapsed),
                            )
                    }
                })
            if (node instanceof LanguageNode && node.id) {
                this.allChildren.set(node.id, result as RuleNode[])
            } else {
                this.allRoots = result as LanguageNode[]
            }
        } else {
            result = node instanceof LanguageNode && node.id ? this.allChildren.get(node.id) : this.allRoots
        }
        return result
    }

    private async getAllRules() {
        if (this.allRules === undefined) {
            this.allRules = await this.allRulesProvider()
        }
        return this.allRules
    }

    public refresh() {
        let copy = { roots: this.allRoots, children: this.allChildren } as Partial<any>
        delete copy.roots
        delete copy.children
        this.allRoots = []
        this.allChildren = new Map()
        this._onDidChangeTreeData.fire(undefined)
    }

    public filter(level?: ConfigLevel) {
        this.levelFilter = level
        this.refresh()
    }

    public register(element: LanguageNode) {
        if (element instanceof LanguageNode) {
            this.allRootsStates.set(element.id, element.collapsibleState)
        }
    }
}

function byName(r1: Rule, r2: Rule) {
    return r1.name.toLowerCase().localeCompare(r2.name.toLowerCase())
}

export function toggleRule(level?: string) {
    return async (ruleKey: string | Rule) => {
        const configuration = getSonarLintConfiguration()
        let rules = configuration.get("rules") || {}
        rules = { ...rules } // config.get immmutable

        if (typeof ruleKey === "string") {
            if (!level) {
                const current = rules[ruleKey] ? rules[ruleKey].level : undefined
                level = !current || current == "on" ? "off" : "on"
            }
            let localLevel = !level ? rules[ruleKey] : level
            rules = Object.assign({ [ruleKey]: { localLevel } }, rules)
            if (localLevel === "off") {
                const result = await coc.window.showPrompt(
                    `Are you sure you want to disable rule ${ruleKey}? `,
                )
                if (!result) {
                    return
                }
            }
            coc.window.showWarningMessage(
                `Changed level of rule ${ruleKey} to ${localLevel}`,
            )
            return await configuration.update(
                "rules",
                rules,
                coc.ConfigurationTarget.Global,
            )
        } else {
            const { key, activeByDefault } = ruleKey
            let localLevel = level

            if (!level) {
                const current = rules[key] ? rules[key].level : undefined
                if (!current) {
                    localLevel = activeByDefault === true ? "off" : "on"
                } else {
                    localLevel = current === "on" ? "off" : "on"
                }
            }
            if (
                (localLevel === "on" && !activeByDefault) ||
                (localLevel === "off" && activeByDefault)
            ) {
                // Override default
                if (!rules[key]) {
                    rules[key] = {}
                }
                rules[key].level = localLevel
            } else {
                // Back to default
                delete rules[key]
            }
            coc.window.showWarningMessage(`Changed l of rule ${key} to ${localLevel}`)
            return await configuration.update(
                "rules",
                rules,
                coc.ConfigurationTarget.Global,
            )
        }
    }
}

async function notifyOnRuleDeactivation(ruleKey: string) {
    const undoAction = "Decline update"
    const showAllRulesAction = "Show rule"
    const selectedAction = await coc.window.showInformationMessage(
        `Sonar rule ${ruleKey} is now disabled in your local environment`,
        undoAction,
        showAllRulesAction,
    )
    if (selectedAction === undoAction) {
        toggleRule("on")(ruleKey)
    } else if (selectedAction === showAllRulesAction) {
        await coc.commands.executeCommand(Commands.OPEN_RULE_BY_KEY, ruleKey)
    }
}
