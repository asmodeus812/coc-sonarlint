import { TreeItem, TreeItemCollapsibleState } from "coc.nvim";

export class ExtendedTreeItem extends TreeItem {
    public contextValue?: string;
    constructor(label: string, state = TreeItemCollapsibleState.None) {
        super(label, state);
    }
}

export type RawAction = {
    command: string;
    title: string;
    detail?: string;
    contextValues: string[];
    arguments?: (c: any) => any[];
};
