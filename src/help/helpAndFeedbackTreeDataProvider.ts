/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { Commands } from "../util/commands";
import { HelpAndFeedbackItem, helpAndFeedbackItems } from "./constants";
import { ExtendedTreeItem } from "../util/types";

export function getHelpAndFeedbackItemById(id: string): HelpAndFeedbackItem | undefined {
    return helpAndFeedbackItems.find((i) => i.id === id);
}

export class HelpAndFeedbackLink extends ExtendedTreeItem {
    constructor(public readonly id: string) {
        const itemById = getHelpAndFeedbackItemById(id);
        super(itemById?.label || "Help unknown", coc.TreeItemCollapsibleState.None);
        this.contextValue = "helpFeedbackLink";
        this.command = {
            command: Commands.HELP_AND_FEEDBACK_LINK,
            title: "Trigger Help and Feedback Link",
            arguments: [itemById]
        };
    }
}

export class HelpAndFeedbackTreeDataProvider implements coc.TreeDataProvider<HelpAndFeedbackLink> {
    private readonly _onDidChangeTreeData = new coc.Emitter<HelpAndFeedbackLink | undefined>();
    readonly onDidChangeTreeData: coc.Event<HelpAndFeedbackLink | undefined> = this._onDidChangeTreeData.event;

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getChildren(_?: HelpAndFeedbackLink): HelpAndFeedbackLink[] {
        return helpAndFeedbackItems.map((item) => new HelpAndFeedbackLink(item.id));
    }

    getTreeItem(element: HelpAndFeedbackLink): ExtendedTreeItem {
        return element;
    }
}
