/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { identity, negate } from "lodash";
import { BindingService } from "../connected/binding";
import { ExtendedServer } from "../lsp/protocol";
import { getSonarLintConfiguration } from "../settings/settings";
import { Commands } from "../util/commands";
import { capitalizeName } from "../util/webview";
import { ExtendedTreeItem } from "../util/types";

type RuleLevel = Extract<ExtendedServer.ConfigLevel, "on" | "off">;

interface RulesConfigEntry {
    level: RuleLevel;
}
type RulesConfig = Record<string, RulesConfigEntry>;

function isActive(rule: ExtendedServer.Rule) {
    return (rule.activeByDefault && rule.levelFromConfig !== "off") || rule.levelFromConfig === "on";
}

function actualLevel(rule: ExtendedServer.Rule) {
    return isActive(rule) ? "on" : "off";
}

export class LanguageNode extends ExtendedTreeItem {
    constructor(label: string) {
        super(label, coc.TreeItemCollapsibleState.Collapsed);
        this.id = label;
        this.contextValue = "language";
        this.tooltip = `Language rules ${label}`;
    }
}

export class RuleNode extends ExtendedTreeItem {
    constructor(public readonly rule: ExtendedServer.Rule) {
        super(rule.name);
        this.id = rule.key.toLowerCase();
        this.tooltip = `Toggle rule ${rule.key}'s status`;
        this.contextValue = "rule";
        this.description = `${rule.key} - ${actualLevel(rule)}`;
        this.command = {
            command: "SonarLint.ToggleRule",
            title: "Toggle current rule",
            arguments: [rule]
        };
    }
}

export type AllRulesNode = LanguageNode | RuleNode;

export class AllRulesTreeDataProvider implements coc.TreeDataProvider<AllRulesNode> {
    private readonly _onDidChangeTreeData = new coc.Emitter<AllRulesNode | undefined>();
    readonly onDidChangeTreeData: coc.Event<AllRulesNode | undefined> = this._onDidChangeTreeData.event;
    private levelFilter?: ExtendedServer.ConfigLevel;
    private allRules: ExtendedServer.RulesResponse | undefined;
    private allNodes: { [key: string]: AllRulesNode } = {};

    constructor(private readonly allRulesProvider: () => coc.Thenable<ExtendedServer.RulesResponse>) {}

    async getChildren(node: AllRulesNode) {
        const localRuleConfig = coc.workspace.getConfiguration("sonarlint.rules");
        return this.getAllRules()
            .then((response) => {
                Object.keys(response).forEach((language) => response[language].sort(byName));
                return response;
            })
            .then((response) => {
                // Render rules under language nodes
                if (node) {
                    return response[node.id as string]
                        .map((rule) => {
                            rule.levelFromConfig = localRuleConfig.get(rule.key, {})["level"];
                            return rule;
                        })
                        .filter((r) => {
                            if (this.levelFilter === "on") {
                                return isActive(r);
                            } else if (this.levelFilter === "off") {
                                return !isActive(r);
                            } else {
                                return true;
                            }
                        })
                        .map((rule) => {
                            const key = rule.key.toLowerCase();
                            let node = this.allNodes[key];
                            if (node === undefined) {
                                node = new RuleNode(rule);
                                this.allNodes[key] = node;
                            }
                            return node;
                        });
                } else {
                    // Roots are language nodes
                    return Object.keys(response)
                        .sort((a, b) => a.localeCompare(b))
                        .map((language) => {
                            let node = this.allNodes[language];
                            if (node === undefined) {
                                node = new LanguageNode(language);
                                this.allNodes[language] = node;
                            }
                            return node;
                        });
                }
            });
    }

    async getAllRules() {
        this.allRules ??= await this.allRulesProvider();
        return this.allRules;
    }

    async getParent(node: AllRulesNode) {
        if (node instanceof LanguageNode) {
            return null;
        } else {
            const response = await this.getAllRules();
            return Object.keys(response)
                .filter((k) => response[k].findIndex((r) => r.key.toUpperCase() === node.rule.key.toUpperCase()) >= 0)
                .map((l) => new LanguageNode(l))
                .pop();
        }
    }

    getTreeItem(node: AllRulesNode) {
        if (node && node.id && this.allNodes[node.id]) {
            return this.allNodes[node.id];
        }
        this.allNodes[node.id as string] = node;
        return node;
    }

    getTreeElement(id: string) {
        return this.allNodes[id];
    }

    refresh() {
        this.allNodes = {};
        this._onDidChangeTreeData.fire(undefined);
    }

    filter(level?: ExtendedServer.ConfigLevel) {
        if (this.levelFilter !== level) {
            this.levelFilter = level;
            this.refresh();
        }
    }

    async checkRuleExists(key: string) {
        return this.getAllRules().then((response) =>
            Object.keys(response).filter((k) => response[k].findIndex((r) => r.key.toUpperCase() === key.toUpperCase()) >= 0).length === 0
                ? `Key not found ${key}`
                : ""
        );
    }
}

function byName(r1: ExtendedServer.Rule, r2: ExtendedServer.Rule) {
    return r1.name.toLowerCase().localeCompare(r2.name.toLowerCase());
}

async function notifyOnRuleDeactivation(ruleKey: string, ruleStatus: string) {
    const okAction = "Ok";
    const undoAction = "Undo";
    const showAllRulesAction = "Show Rule";
    const selectedAction = await coc.window.showInformationMessage(
        `Sonar rule ${ruleKey} is now ${ruleStatus} in your local environment`,
        okAction,
        undoAction,
        showAllRulesAction
    );
    if (selectedAction === undoAction) {
        toggleRule("on")(ruleKey);
    } else if (selectedAction === showAllRulesAction) {
        await coc.commands.executeCommand(Commands.OPEN_RULE_BY_KEY, ruleKey);
    }
}

export function setRulesViewMessage(allRulesView: coc.TreeView<LanguageNode>) {
    const folderBindingStates = [...BindingService.instance.bindingStatePerFolder().values()];
    if (allFalse(folderBindingStates)) {
        allRulesView.message =
            "Changes to this view are restricted to your personal development environment; to share a rule set with your team, please use Connected Mode .";
    } else {
        allRulesView.message = "Changes to this view only apply to folders that don't use Connected Mode.";
    }
}

export function allTrue(values: boolean[]) {
    return values.length > 0 && values.every(identity);
}

export function allFalse(values: boolean[]) {
    return values.length === 0 || values.every(negate(identity));
}

export function toggleRule(explicitLevel?: RuleLevel) {
    return async (rule: string | ExtendedServer.Rule) => {
        const config = getSonarLintConfiguration();
        const key = typeof rule === "string" ? rule : rule.key;
        const knowsDefault = typeof rule !== "string";
        const activeByDefault = knowsDefault ? !!rule.activeByDefault : undefined;

        // 1) read snapshot (read-only), then clone
        const currentRules = config.get<RulesConfig>("rules") ?? {};
        const rules: RulesConfig = { ...currentRules };

        // current override (may be undefined = using default/effective)
        const current: RuleLevel | undefined = rules[key]?.level;

        // 2) decide next level
        // explicit wins; otherwise toggle from effective:
        // - effective base = current override, else:
        //     * if we know default → activeByDefault
        //     * if we don't know default → ASSUME 'on'  (changed from 'off')
        const base: RuleLevel = current ?? (knowsDefault ? (activeByDefault ? "on" : "off") : "on");

        const next: RuleLevel = explicitLevel ?? (base === "on" ? "off" : "on");

        // 3) early exit if nothing changes
        const effectiveBefore: RuleLevel = current ?? (knowsDefault ? (activeByDefault! ? "on" : "off") : "on");

        if (next === effectiveBefore) {
            await coc.window.showWarningMessage(`The rule ${key} is already ${next}`);
            return;
        }

        // 4) confirm when turning a rule OFF
        if (next === "off") {
            if (!(await coc.window.showPrompt(`Are you sure you want to disable rule ${key}?`))) {
                return;
            }
        }

        // 5) compute new config:
        // If we know the default, only store an override when it differs from default.
        // If we don't know default (string input), we always store explicit override.
        if (knowsDefault) {
            const differsFromDefault = (next === "on" && activeByDefault === false) || (next === "off" && activeByDefault === true);

            if (differsFromDefault) {
                rules[key] = { level: next };
            } else {
                // going back to default -> remove override
                if (rules[key]) delete rules[key];
            }
        } else {
            rules[key] = { level: next };
        }

        // 6) persist only if config actually changed
        if (JSON.stringify(rules) === JSON.stringify(currentRules)) {
            await coc.window.showWarningMessage(`No changes made to update rule ${key} configuration`);
        }

        try {
            // the sonar rules should be globally configured as they might not work on a per workspace basis
            await config.update("rules", rules, coc.ConfigurationTarget.Global);
            await notifyOnRuleDeactivation(key, next);
        } catch (err) {
            await coc.window.showWarningMessage(`Failed to update the rule ${key}: ${(err as Error).message}`);
        }
    };
}

export function userNormalizedLanguageKey(sonarLanguageKey: string): string {
    switch (sonarLanguageKey) {
        case "markdown":
            return "Secrets";
        case "css":
        case "scss":
        case "Css":
        case "Scss":
            return "CSS";
        case "htm":
        case "htmx":
        case "html":
        case "Html":
            return "HTML";
        case "js":
        case "javascript":
            return "JavaScript";
        case "ts":
        case "typescript":
            return "TypeScript";
        case "py":
        case "python":
            return "Python";
        case "ipy":
        case "ipynb":
        case "ipython":
            return "IPython Notebooks";
        case "arm":
        case "azure":
        case "azureresmgr":
        case "azureresource":
        case "azureresourcemanager":
            return "AzureResourceManager";
        case "cpp":
        case "cplus":
        case "cplusplus":
            return "C++";
        case "k8s":
        case "yml":
        case "yaml":
            return "Kubernetes";
        default:
            return capitalizeName(sonarLanguageKey);
    }
}

export function languageKeyDeNormalization(sonarLanguageKey: string): string {
    switch (sonarLanguageKey) {
        case "cpp":
        case "cplus":
        case "cplusplus":
            return "cpp";
        case "scss":
        case "Scss":
            return "css";
        case "htm":
        case "htmx":
            return "HTML";
        case "js":
            return "JavaScript";
        case "ts":
            return "TypeScript";
        case "py":
            return "Python";
        case "ipy":
        case "ipynb":
            return "ipython";
        case "arm":
        case "azure":
        case "azureresmgr":
        case "azureresource":
            return "azureresourcemanager";
        case "k8s":
        case "yml":
        case "yaml":
            return "kubernetes";
        default:
            return sonarLanguageKey.toLowerCase();
    }
}
