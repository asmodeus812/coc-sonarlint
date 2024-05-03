/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { ConfigLevel, Rule, RulesResponse } from "../lsp/protocol";
import { getSonarLintConfiguration } from "../settings/settings";
import { Commands } from "../util/commands";

function isActive(rule: Rule) {
    return (
        (rule.activeByDefault && rule.levelFromConfig !== "off") ||
        rule.levelFromConfig === "on"
    );
}

function actualLevel(rule: Rule) {
    return isActive(rule) ? "on" : "off";
}

export class LanguageNode extends coc.TreeItem {
    constructor(label: string, state: coc.TreeItemCollapsibleState | undefined) {
        super(label, state || coc.TreeItemCollapsibleState.Collapsed);
        this.tooltip = "language";
    }
}

export class RuleNode extends coc.TreeItem {
    constructor(public readonly rule: Rule) {
        super(rule.name);
        this.id = rule.key.toUpperCase();
        this.tooltip = `Toggle rule ${rule.key} status`;
        this.description = `${rule.key} - ${actualLevel(rule)}`;
        this.command = {
            command: "SonarLint.ToggleRule",
            title: "Toggle current rule",
            arguments: [rule],
        };
    }
}

export type AllRulesNode = LanguageNode | RuleNode;

export class AllRulesTreeDataProvider
    implements coc.TreeDataProvider<AllRulesNode>
{
    private readonly _onDidChangeTreeData = new coc.Emitter<
        AllRulesNode | undefined
    >();
    readonly onDidChangeTreeData: coc.Event<AllRulesNode | undefined> =
        this._onDidChangeTreeData.event;
    private levelFilter?: ConfigLevel;
    private allRules: RulesResponse | undefined;

    constructor(
        private readonly allRulesProvider: () => Thenable<RulesResponse>,
        private readonly elementStatus: Map<
            string | coc.TreeItemLabel | undefined,
            coc.TreeItemCollapsibleState | undefined
        >,
    ) { }

    public getTreeItem(node: AllRulesNode) {
        return node;
    }

    public async getParent(node: AllRulesNode) {
        if (node instanceof LanguageNode) {
            return null;
        } else {
            const response = await this.getAllRules();
            return Object.keys(response)
                .filter(
                    (k) =>
                        response[k].findIndex(
                            (r) => r.key.toUpperCase() === node.rule.key.toUpperCase(),
                        ) >= 0,
                )
                .map((l) => new LanguageNode(l, this.elementStatus.get(l)))
                .pop();
        }
    }

    public async getChildren(node: AllRulesNode) {
        const localRuleConfig = coc.workspace.getConfiguration("sonarlint.rules");
        return this.getAllRules()
            .then((response) => {
                Object.keys(response).forEach((language) =>
                    response[language].sort(byName),
                );
                return response;
            })
            .then((response) => {
                // Render rules under language nodes
                if (node) {
                    return response[node.label as string]
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
                        .map((rule) => new RuleNode(rule));
                } else {
                    // Roots are language nodes
                    return Object.keys(response)
                        .sort()
                        .map(
                            (language) =>
                                new LanguageNode(language, this.elementStatus.get(language)),
                        );
                }
            });
    }

    private async getAllRules() {
        if (this.allRules === undefined) {
            this.allRules = await this.allRulesProvider();
        }
        return this.allRules;
    }

    public refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    public filter(level?: ConfigLevel) {
        this.levelFilter = level;
        this.refresh();
    }

    public register(element: LanguageNode) {
        this.elementStatus.set(element.label, element.collapsibleState);
    }
}

function byName(r1: Rule, r2: Rule) {
    return r1.name.toLowerCase().localeCompare(r2.name.toLowerCase());
}

export function toggleRule(level: ConfigLevel | undefined) {
    return async (ruleKey: string | Rule) => {
        const configuration = getSonarLintConfiguration();
        let rules = configuration.get("rules") || {};

        if (typeof ruleKey === "string") {
            // This is when a rule is deactivated from a code action, and we only have the key, not the default activation.
            if (!level) {
                const current = rules[ruleKey] ? rules[ruleKey].level : undefined;
                level = !current || current == "on" ? "off" : "on";
            }
            level = level == undefined ? rules[ruleKey] : level;
            rules = Object.assign({ [ruleKey]: { level } }, rules);
            if (level === "off") {
                const result = await coc.window.showPrompt(
                    `Are you sure you want to disable rule ${ruleKey}? `,
                );
                if (!result) {
                    return;
                }
            }
            coc.window.showWarningMessage(
                `Changed level of rule ${ruleKey} to ${level}`,
            );
            return await configuration.update(
                "rules",
                rules,
                coc.ConfigurationTarget.Global,
            );
        } else {
            // When a rule is toggled from the list of rules, we can be smarter!
            const { key, activeByDefault } = ruleKey;
            if (!level) {
                const current = rules[key] ? rules[key].level : undefined;
                level = current == "on" || activeByDefault ? "off" : "on";
            }
            if (
                (level === "on" && !activeByDefault) ||
                (level === "off" && activeByDefault)
            ) {
                // Override default
                rules = Object.assign({ [key]: { level } }, rules);
            } else {
                // Back to default
                rules = Object.assign({ [key]: undefined }, rules);
            }
            coc.window.showWarningMessage(`Changed level of rule ${key} to ${level}`);
            return await configuration.update(
                "rules",
                rules,
                coc.ConfigurationTarget.Global,
            );
        }
    };
}

async function notifyOnRuleDeactivation(ruleKey: string) {
    const undoAction = "Decline update";
    const showAllRulesAction = "Show rule";
    const selectedAction = await coc.window.showInformationMessage(
        `Sonar rule ${ruleKey} is now disabled in your local environment`,
        undoAction,
        showAllRulesAction,
    );
    if (selectedAction === undoAction) {
        toggleRule("on")(ruleKey);
    } else if (selectedAction === showAllRulesAction) {
        await coc.commands.executeCommand(Commands.OPEN_RULE_BY_KEY, ruleKey);
    }
}
