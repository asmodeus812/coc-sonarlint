/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { ExtendedClient } from "../lsp/protocol";
import { Commands } from "../util/commands";
import { ExtendedTreeItem } from "../util/types";
import { focusResourceLocation } from "../util/util";

export class IssueItem extends ExtendedTreeItem {
    readonly children: FlowItem[] | LocationItem[];

    constructor(issueOrHotspot: ExtendedClient.Issue) {
        const highlightOnly = issueOrHotspot.flows.every((f) => f.locations.every((l) => !l.message || l.message === ""));
        const collapsibleState = highlightOnly ? coc.TreeItemCollapsibleState.None : coc.TreeItemCollapsibleState.Expanded;
        super(issueOrHotspot.message, collapsibleState);
        this.description = `(${issueOrHotspot.ruleKey})`;
        if (highlightOnly) {
            // "Highlight only" locations, no node appended
            this.children = [];
        } else if (issueOrHotspot.flows.every((f) => f.locations.length === 1)) {
            // All flows have one location (e.g duplication): flatten to location nodes
            this.children = issueOrHotspot.flows.map((f, i) => new LocationItem(f.locations[0], i + 1, this));
        } else {
            // General case
            this.children = issueOrHotspot.flows.map((f, i) => new FlowItem(f, i, this));
        }
        this.contextValue = "issueItem";
    }
}

export class FlowItem extends ExtendedTreeItem {
    readonly parent: LocationTreeItem;
    readonly children: (LocationItem | FileItem)[];

    constructor(flow: ExtendedClient.Flow, index: number, parent: LocationTreeItem) {
        // Only first flow is expanded by default
        const collapsibleState = index === 0 ? coc.TreeItemCollapsibleState.Expanded : coc.TreeItemCollapsibleState.Collapsed;
        super(`Flow ${index + 1}`, collapsibleState);

        const flowLocations: any[] = Array.from(flow.locations);
        flowLocations.reverse();

        if (new Set(flowLocations.map((l) => l.uri)).size > 1) {
            // Locations are spread over several files: group locations by file URI
            let locationIndex = 0;
            let currentUri: string | undefined;
            let currentPath: string | undefined;
            let fileLocations = [];
            this.children = [];
            while (locationIndex < flowLocations.length) {
                currentUri = flowLocations[locationIndex].uri;
                currentPath = flowLocations[locationIndex].filePath;
                fileLocations.push(flowLocations[locationIndex] as never);
                if ((currentUri && locationIndex === flowLocations.length - 1) || flowLocations[locationIndex + 1].uri !== currentUri) {
                    this.children.push(new FileItem(currentUri as string, currentPath as string, locationIndex + 1, fileLocations, this));
                    fileLocations = [];
                }
                locationIndex += 1;
            }
        } else {
            // Locations are all in the current file
            this.children = flowLocations.map((l, i) => new LocationItem(l, i + 1, this));
        }

        this.parent = parent;
        this.contextValue = "flowIssue";
    }
}

export class FileItem extends ExtendedTreeItem {
    readonly children: LocationItem[];
    readonly parent: FlowItem;

    constructor(uri: string | null, filePath: string, lastIndex: number, locations: ExtendedClient.Location[], parent: FlowItem) {
        const label = uri ? uri.substring(uri.lastIndexOf("/") + 1) : filePath.substring(filePath.lastIndexOf("/") + 1);
        super(label, coc.TreeItemCollapsibleState.Expanded);
        this.children = locations.map((l, i) => new LocationItem(l, lastIndex + 1 - locations.length + i, this));
        this.parent = parent;
        this.contextValue = "fileItem";
        this.resourceUri = uri ? coc.Uri.parse(uri) : undefined;
        this.tooltip = filePath;
    }
}

export class LocationItem extends ExtendedTreeItem {
    constructor(
        readonly location: ExtendedClient.Location,
        readonly index: number,
        readonly parent: LocationParentItem
    ) {
        super(`${index}: ${location.message}`, coc.TreeItemCollapsibleState.None);
        this.index = index;
        if (location.uri) {
            if (location.exists) {
                if (location.codeMatches) {
                    this.description = `[${location.textRange.startLine}, ${location.textRange.startLineOffset}]`;
                } else {
                    this.description = "(local code does not match)";
                }
                this.command = {
                    title: "Navigate",
                    command: Commands.NAVIGATE_TO_LOCATION,
                    arguments: [this]
                };
            } else {
                this.description = "(unreachable in local code)";
            }
        } else {
            this.description = "(unreachable in local code)";
        }
        this.parent = parent;
        this.location = location;
        this.contextValue = "locationItem";
    }
}

type ChildItem = FlowItem | FileItem | LocationItem;

type LocationParentItem = IssueItem | FlowItem | FileItem;

export type LocationTreeItem = IssueItem | ChildItem;

export class SecondaryLocationsTree implements coc.TreeDataProvider<LocationTreeItem> {
    private readonly _onDidChangeTreeData = new coc.Emitter<LocationTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private rootItem?: IssueItem | null;

    constructor() {
        this.rootItem = null;
    }

    async showAllLocations(issue: ExtendedClient.Issue) {
        this.rootItem = new IssueItem(issue);
        if (this.rootItem.children.length === 0) {
            const uri = issue.fileUri;
            await focusResourceLocation(uri);

            const locations = issue.flows.map((f) => f.locations).reduce((acc, cur) => acc.concat(cur), []);
            if (locations.length <= 0) {
                const range = computeTextRange(issue.textRange);
                await revealTextRange(range);
            }
        } else if (this.rootItem.children[0] instanceof LocationItem) {
            // Flattened locations: take the first one
            await navigateToLocation(this.rootItem.children[0]);
        } else if (this.rootItem.children[0].children[0] instanceof LocationItem) {
            // Locations in a single file: take the first location of the first flow
            await navigateToLocation(this.rootItem.children[0].children[0]);
        } else {
            // Multiple file locations: take the first location of the first file of the first flow
            await navigateToLocation(this.rootItem.children[0].children[0].children[0]);
        }
        this.notifyRootChanged();
    }

    hideLocations() {
        this.rootItem = null;
        this.notifyRootChanged();
    }

    notifyRootChanged() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: LocationTreeItem): ExtendedTreeItem {
        return element;
    }

    getChildren(element?: LocationTreeItem): coc.ProviderResult<LocationTreeItem[]> {
        if (!element) {
            return [this.rootItem as any];
        } else if (element instanceof IssueItem) {
            return element.children;
        } else if (element instanceof FlowItem) {
            return element.children;
        } else if (element instanceof FileItem) {
            return element.children;
        } else {
            return [];
        }
    }

    getParent(element?: LocationTreeItem) {
        if (element === this.rootItem) {
            return null;
        } else {
            return (element as ChildItem).parent;
        }
    }
}

export async function navigateToLocation(item: LocationItem) {
    const textRange = item.location.textRange;
    const uri = item.location.uri ? item.location.uri : item.location.filePath;
    await focusResourceLocation(uri);
    const range = computeTextRange(textRange);
    await revealTextRange(range);
}

export async function revealTextRange(range: coc.Range | undefined | null) {
    if (!range || range === undefined) return;

    const nvim = coc.workspace.nvim;

    const startLine = range.start.line + 1; // 1-based
    const startCol = range.start.character + 1;
    const endLine = range.end.line + 1;
    const endCol = Math.max(1, range.end.character); // avoid 0 column

    await nvim.call("cursor", [startLine, startCol]);
    await nvim.command("normal! v");
    await nvim.call("cursor", [endLine, endCol]);
    await nvim.command("normal! zz");
}

export function computeTextRange(textRange: ExtendedClient.TextRange): coc.Range | undefined | null {
    if (
        textRange.startLine !== undefined &&
        textRange.startLineOffset !== undefined &&
        textRange.endLine !== undefined &&
        textRange.endLineOffset !== undefined
    ) {
        const startPosition = coc.Position.create(textRange.startLine - 1, textRange.startLineOffset);
        const endPosition = coc.Position.create(textRange.endLine - 1, textRange.endLineOffset);
        return coc.Range.create(startPosition, endPosition);
    }
    return null;
}
