import { ExtendedClient } from "../lsp/protocol";
import * as coc from "coc.nvim";
import { logToSonarLintOutput } from "../util/logging";
import { SonarLintExtendedLanguageClient } from "../lsp/client";
import { pathExists } from "../util/uri";
import { showNoFileWithUriError } from "../util/showMessage";
import { focusResourceLocation } from "../util/util";

export class FixSuggestionService {
    private static readonly END_OF_LINE_OFFSET = 10000;
    private static _instance: FixSuggestionService;

    static init(client: SonarLintExtendedLanguageClient) {
        FixSuggestionService._instance = new FixSuggestionService(client);
    }
    constructor(private readonly client: SonarLintExtendedLanguageClient) {}

    static get instance() {
        return FixSuggestionService._instance;
    }

    showFixSuggestion = async (params: ExtendedClient.ShowFixSuggestionParams) => {
        try {
            const fileUri = coc.Uri.parse(params.fileUri);
            if (!(await pathExists(fileUri))) {
                showNoFileWithUriError(fileUri);
                return;
            }
            await focusResourceLocation(fileUri);
            const workspaceEdit = { changes: { [fileUri.toString()]: [] } } as coc.WorkspaceEdit;
            for (const edit of params.textEdits) {
                await (async () => {
                    const range = coc.Range.create(
                        edit.beforeLineRange.startLine - 1,
                        0,
                        edit.beforeLineRange.endLine - 1,
                        FixSuggestionService.END_OF_LINE_OFFSET
                    );
                    const isContentIdentical = params.isLocal || (await this.isBeforeContentIdentical(fileUri, range, edit.before));
                    if (!isContentIdentical) {
                        coc.window.showWarningMessage("The content of the file has changed. The fix suggestion may not be applicable.");
                    }
                    const textEdit: coc.TextEdit = coc.TextEdit.replace(range, edit.after);
                    workspaceEdit[fileUri.toString()] = workspaceEdit[fileUri.toString()].push(textEdit);
                })();
            }
            const result = await coc.workspace.applyEdit(workspaceEdit);
            // result will be true if at least one edit was applied
            // result will be false if no edits were applied
            if (result) {
                coc.window.showInformationMessage("Sonarlint: AI Fix applied.");
            } else {
                coc.window.showInformationMessage("Sonarlint: AI Fix declined.");
            }
            this.client.fixSuggestionResolved(params.suggestionId, result);
        } catch (error) {
            logToSonarLintOutput("Failed to apply edit: ".concat((error as Error).message));
        }
    };

    isBeforeContentIdentical = async (fileUri: coc.Uri, range: coc.Range, before: string) => {
        const doc = await coc.workspace.openTextDocument(fileUri);
        return doc.textDocument.getText(range) === before;
    };
}
