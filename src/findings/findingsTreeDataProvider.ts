/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { Diagnostic } from "coc.nvim";
import * as fse from "fs";
import { resolveIssueMultiStepInput } from "../issue/resolveIssue";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import { ExtendedClient, ExtendedServer } from "../lsp/protocol";
import { isFocusingOnNewCode } from "../settings/settings";
import { ExtendedTreeItem } from "../util/types";
import { convertVscodeDiagnosticToLspDiagnostic, showActionQuickPick } from "../util/util";
import { FindingsFileNode } from "./findingsFileNode";
import { FindingsFolderNode } from "./findingsFolderNode";
import {
    FilterType,
    FindingType,
    NOTEBOOK_CELL_URI_SCHEME,
    isCurrentFile,
    isFileOpen,
    isNotebookCellUri
} from "./findingsTreeDataProviderUtil";
import { DependencyRiskNode } from "./findingTypes/dependencyRiskNode";
import { FindingNode } from "./findingTypes/findingNode";
import { HotspotNode } from "./findingTypes/hotspotNode";
import { NotebookFindingNode } from "./findingTypes/notebookFindingNode";
import { TaintVulnerabilityNode } from "./findingTypes/taintVulnerabilityNode";
import { NotebookNode } from "./notebookNode";

export class NewIssuesNode extends ExtendedTreeItem {
    constructor() {
        super("New Findings", coc.TreeItemCollapsibleState.Expanded);
        this.contextValue = "newIssuesGroup";
        this.id = "new-issues";
    }
}

export class OlderIssuesNode extends ExtendedTreeItem {
    constructor() {
        super("Older Findings", coc.TreeItemCollapsibleState.Collapsed);
        this.contextValue = "olderIssuesGroup";
        this.id = "older-issues";
    }
}

export type FindingsTreeViewItem = FindingsFileNode | FindingNode | NewIssuesNode | OlderIssuesNode;
export class FindingsTreeDataProvider implements coc.TreeDataProvider<FindingsTreeViewItem> {
    private static _instance: FindingsTreeDataProvider;
    private readonly _onDidChangeTreeData = new coc.Emitter<FindingsTreeViewItem | undefined>();
    readonly onDidChangeTreeData: coc.Event<FindingsTreeViewItem | undefined> = this._onDidChangeTreeData.event;
    private readonly findingsCache = new Map<string, FindingNode[]>();
    private activeFilter: FilterType = FilterType.All;

    constructor(private readonly client: SonarLintExtendedLanguageClient) {
        // NOP
    }

    static init(client: SonarLintExtendedLanguageClient) {
        this._instance = new FindingsTreeDataProvider(client);
    }

    static get instance(): FindingsTreeDataProvider {
        return FindingsTreeDataProvider._instance;
    }

    async showAllInfoForFinding(finding: FindingNode) {
        await showFindingsActionsQuickPick(finding);
    }

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    updateHotspots(hotspotsPerFile: ExtendedClient.PublishDiagnosticsParams) {
        const findingNodes = this.convertHotspotsToFindingNodes(hotspotsPerFile);
        this.updateFindingsForFile(hotspotsPerFile.uri, findingNodes, FindingType.SecurityHotspot);
    }

    updateTaintVulnerabilities(fileUri: string, diagnostics: Diagnostic[]) {
        const findingNodes = this.convertTaintVulnerabilitiesToFindingNodes(fileUri, diagnostics);
        this.updateFindingsForFile(fileUri, findingNodes, FindingType.TaintVulnerability);
    }

    updateIssues(fileUri: string, diagnostics: coc.Diagnostic[]) {
        const findingNodes = this.convertIssuesToFindingNodes(fileUri, diagnostics);
        this.updateFindingsForFile(fileUri, findingNodes, FindingType.Issue);
    }

    updateDependencyRisks(dependencyRisksPerFolder: ExtendedClient.PublishDiagnosticsParams) {
        const findingNodes = this.convertDependencyRisksToFindingNodes(dependencyRisksPerFolder.uri, dependencyRisksPerFolder.diagnostics);
        this.updateFindingsForFile(dependencyRisksPerFolder.uri, findingNodes, FindingType.DependencyRisk);
    }

    private updateFindingsForFile(fileUri: string, newFindings: FindingNode[], findingType: FindingType) {
        const existingFindings = this.findingsCache.get(fileUri) || [];

        // Remove existing findings of this type
        const otherFindings = existingFindings.filter((f) => f.findingType !== findingType);

        // Add new findings
        const allFindings = [...otherFindings, ...newFindings];
        if (allFindings.length > 0) {
            this.findingsCache.set(fileUri, allFindings);
        } else {
            this.findingsCache.delete(fileUri);
        }

        this.refresh();
    }

    private convertHotspotsToFindingNodes(hotspotsPerFile: ExtendedClient.PublishDiagnosticsParams): FindingNode[] {
        return hotspotsPerFile.diagnostics.map((diagnostic) => new HotspotNode(hotspotsPerFile.uri, diagnostic));
    }

    private convertTaintVulnerabilitiesToFindingNodes(fileUri: string, diagnostics: Diagnostic[]): FindingNode[] {
        return diagnostics.map((diagnostic) => new TaintVulnerabilityNode(fileUri, diagnostic));
    }

    private convertIssuesToFindingNodes(fileUri: string, diagnostics: coc.Diagnostic[]): FindingNode[] {
        return diagnostics.map((diagnostic) =>
            isNotebookCellUri(fileUri)
                ? new NotebookFindingNode(fileUri, convertVscodeDiagnosticToLspDiagnostic(diagnostic))
                : new FindingNode(fileUri, FindingType.Issue, convertVscodeDiagnosticToLspDiagnostic(diagnostic))
        );
    }

    private convertDependencyRisksToFindingNodes(folderUri: string, diagnostics: Diagnostic[]): FindingNode[] {
        return diagnostics.map((diagnostic) => new DependencyRiskNode(folderUri, diagnostic));
    }

    getTreeItem(element: FindingsTreeViewItem): ExtendedTreeItem {
        return element;
    }

    async getChildren(element?: FindingsTreeViewItem): Promise<FindingsTreeViewItem[]> {
        if (!element) {
            return await this.getRootItems();
        }

        if (element instanceof NewIssuesNode) {
            return await this.getNewIssuesFiles();
        }

        if (element instanceof OlderIssuesNode) {
            return this.getOlderIssuesFiles();
        }

        if (element instanceof FindingsFileNode) {
            const allFindings =
                element instanceof NotebookNode
                    ? this.getFindingsForNotebook(element.notebookCellUris as string[])
                    : this.getFindingsForFile(element.fileUri);
            return this.filterFindings(allFindings, element.category);
        }

        return [];
    }

    async getParent(element: FindingsTreeViewItem): Promise<FindingsTreeViewItem | undefined> {
        if (element instanceof NewIssuesNode || element instanceof OlderIssuesNode) {
            return undefined;
        }

        if (element instanceof FindingsFileNode) {
            if (isFocusingOnNewCode()) {
                // If the file node has a category, return the appropriate parent
                if (element.category === "new") {
                    return new NewIssuesNode();
                } else if (element.category === "older") {
                    return new OlderIssuesNode();
                }
                return undefined;
            }
            return undefined;
        }

        const rootFiles = await this.getRootFiles();
        const parentFile = rootFiles.find((file) => file.fileUri === element.fileUri);
        if (parentFile) {
            if (isFocusingOnNewCode()) {
                return element.isOnNewCode ? new NewIssuesNode() : new OlderIssuesNode();
            }
            return parentFile;
        }

        return undefined;
    }

    private async getRootItems(): Promise<FindingsTreeViewItem[]> {
        if (isFocusingOnNewCode()) {
            const newIssuesFiles = await this.getNewIssuesFiles();
            const olderIssuesFiles = await this.getOlderIssuesFiles();

            const items: FindingsTreeViewItem[] = [];

            if (newIssuesFiles.length > 0) {
                items.push(new NewIssuesNode());
            }

            if (olderIssuesFiles.length > 0) {
                items.push(new OlderIssuesNode());
            }

            return items;
        } else {
            return await this.getRootFiles();
        }
    }

    private async getNewIssuesFiles(): Promise<FindingsFileNode[]> {
        const files: FindingsFileNode[] = [];

        for (const [fileUri, findings] of this.findingsCache.entries()) {
            const newFindings = findings.filter((finding) => finding.isOnNewCode && this.matchesFilter(finding));
            if (newFindings.length > 0) {
                await this.addFileNode(fileUri, files, newFindings.length, "new");
            }
        }

        return files;
    }

    private async getOlderIssuesFiles(): Promise<FindingsFileNode[]> {
        const files: FindingsFileNode[] = [];

        for (const [fileUri, findings] of this.findingsCache.entries()) {
            const olderFindings = findings.filter((finding) => !finding.isOnNewCode && this.matchesFilter(finding));
            if (olderFindings.length > 0) {
                await this.addFileNode(fileUri, files, olderFindings.length, "older");
            }
        }

        return files;
    }

    async getRootFiles(): Promise<FindingsFileNode[]> {
        const files: FindingsFileNode[] = [];

        for (const [fileUri, findings] of this.findingsCache.entries()) {
            const filteredFindings = findings.filter((finding) => this.matchesFilter(finding));
            if (filteredFindings.length > 0) {
                await this.addFileNode(fileUri, files, filteredFindings.length);
            }
        }

        return files;
    }

    private async addFileNode(
        fileOrCellUri: string,
        existingFiles: (FindingsFileNode | NotebookNode)[],
        findingsCount: number,
        category?: "new" | "older"
    ) {
        const notebookCellUri = coc.Uri.parse(fileOrCellUri);
        if (fileOrCellUri.startsWith(NOTEBOOK_CELL_URI_SCHEME)) {
            // register only one notebook file for (possible) multiple cells
            const notebookUri = coc.Uri.from({ scheme: "file", path: notebookCellUri.path }).toString();
            const notebookFile = existingFiles.find((file) => file.fileUri === notebookUri);
            if (notebookFile) {
                (notebookFile as NotebookNode).notebookCellUris?.push(fileOrCellUri);
                return;
            }
            existingFiles.push(new NotebookNode(notebookUri, findingsCount, category, [fileOrCellUri]));
        } else if (fse.existsSync(notebookCellUri.fsPath) && fse.statSync(notebookCellUri.fsPath).isDirectory()) {
            existingFiles.push(new FindingsFolderNode(fileOrCellUri, findingsCount, category));
        } else {
            existingFiles.push(new FindingsFileNode(fileOrCellUri, findingsCount, category));
        }
    }

    private matchesFilter(finding: FindingNode): boolean {
        if (this.activeFilter === FilterType.All) {
            return true;
        } else if (this.activeFilter === FilterType.Fix_Available) {
            return finding.isAiCodeFixable || finding.hasQuickFix;
        } else if (this.activeFilter === FilterType.Open_Files_Only) {
            return isFileOpen(finding.fileUri);
        } else if (this.activeFilter === FilterType.High_Severity_Only) {
            return (
                finding.impactSeverity === ExtendedServer.ImpactSeverity.HIGH ||
                finding.impactSeverity === ExtendedServer.ImpactSeverity.BLOCKER
            );
        } else if (this.activeFilter === FilterType.Current_File_Only) {
            return isCurrentFile(coc.Uri.parse(finding.fileUri).toString());
        }
        return false;
    }

    private getFindingsForNotebook(notebookCellUris: string[]): FindingNode[] {
        return Array.from(notebookCellUris)
            .map((uri) => this.findingsCache.get(uri) || [])
            .reduce((acc, findings) => acc.concat(findings), []);
    }

    private getFindingsForFile(fileUri: string): FindingNode[] {
        return this.findingsCache.get(fileUri) || [];
    }

    private filterFindings(findings: FindingNode[], category?: "new" | "older"): FindingNode[] {
        let filteredFindings = findings.filter((finding) => this.matchesFilter(finding));

        if (category) {
            const lookingForNew = category === "new";
            // looking for new and is new, or looking for older and is older
            filteredFindings = filteredFindings.filter((finding) => finding.isOnNewCode === lookingForNew);
        }

        return filteredFindings;
    }

    getHotspotsForFile(fileUri: string): FindingNode[] {
        return this.findingsCache.get(fileUri)?.filter((finding) => finding.findingType === FindingType.SecurityHotspot) || [];
    }

    getTaintsForFile(fileUri: string): FindingNode[] {
        return this.findingsCache.get(fileUri)?.filter((finding) => finding.findingType === FindingType.TaintVulnerability) || [];
    }

    getTaintVulnerabilitiesForFile(fileUri: string): FindingNode[] {
        return this.findingsCache.get(fileUri)?.filter((finding) => finding.findingType === FindingType.TaintVulnerability) || [];
    }

    getTotalFindingsCount(): number {
        return Array.from(this.findingsCache.values()).reduce((total, findings) => total + findings.length, 0);
    }

    setFilter(filter: FilterType) {
        this.activeFilter = filter;
        this.refresh();
        this.client.findingsFiltered(filter);
    }

    getActiveFilter(): FilterType {
        return this.activeFilter;
    }

    getFilteredFindingsCount(): number {
        if (this.activeFilter === FilterType.All) {
            return this.getTotalFindingsCount();
        }

        return Array.from(this.findingsCache.values()).reduce((total, findings) => {
            return total + findings.filter((finding) => this.matchesFilter(finding)).length;
        }, 0);
    }

    async changeDependencyRiskStatus(finding: FindingNode) {
        resolveIssueMultiStepInput(finding.fileUri, finding.key, finding.fileUri, false, true);
    }
}

type RawAction = {
    command: string;
    title: string;
    detail?: string;
    contextValues: string[];
    arguments?: (f: FindingNode) => any[];
};

const FINDINGS_ACTIONS: RawAction[] = [
    {
        command: "SonarLint.NavigateToFindingLocation",
        title: "Goto issue location",
        contextValues: ["*"]
    },
    {
        command: "SonarLint.OpenRuleDesc",
        title: "Show rule details",
        contextValues: ["*"],
        arguments: (finding: FindingNode) => {
            return [finding.ruleKey, finding.fileUri];
        }
    },
    {
        command: "SonarLint.DeactivateRule",
        title: "Disable issue rule",
        contextValues: ["*"],
        arguments: (finding: FindingNode) => {
            return [finding.ruleKey];
        }
    },
    {
        command: "SonarLint.TriggerBrowseTaintCommand",
        title: "Open Taint Vulnerability",
        contextValues: ["taintVulnerabilityItem"]
    },
    {
        command: "SonarQube.TriggerAiCodeFixCommand",
        title: "Apply AI Suggestion",
        contextValues: ["AICodeFixableTaintItem", "AICodeFixableIssueItem"]
    },
    {
        command: "SonarQube.TriggerResolveTaintCommand",
        title: "Update this Issue",
        contextValues: ["taintVulnerabilityItem", "AICodeFixableTaintItem"]
    },
    {
        command: "SonarLint.OpenHotspotOnServer",
        title: "Review on Server",
        detail: "Hotspot",
        contextValues: ["knownHotspotItem"]
    },
    {
        command: "SonarLint.ShowHotspotRuleDescription",
        title: "Show Hotspot Details",
        detail: "Hotspot",
        contextValues: ["newHotspotItem"]
    },
    {
        command: "SonarLint.ShowHotspotDetails",
        title: "Show Hotspot Details",
        detail: "Hotspot",
        contextValues: ["knownHotspotItem"]
    },
    {
        command: "SonarLint.ChangeHotspotStatus",
        title: "Change Status",
        detail: "Hotspot",
        contextValues: ["knownHotspotItem"]
    },
    {
        command: "SonarLint.ChangeDependencyRiskStatus",
        title: "Change Status",
        detail: "Dependency Risk",
        contextValues: ["dependencyRiskItem"]
    }
];

async function showFindingsActionsQuickPick(finding: FindingNode): Promise<void> {
    await showActionQuickPick(FINDINGS_ACTIONS, finding);
}
