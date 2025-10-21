/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

"use strict";

import * as coc from "coc.nvim";

import { ExtendedClient } from "../lsp/protocol";

export async function adaptFlows(issue: ExtendedClient.Issue) {
    return Promise.all(
        issue.flows.map(async (flow) => {
            flow.locations = await adaptLocations(flow);
            return flow;
        })
    );
}

export async function adaptLocations(flow: ExtendedClient.Flow) {
    return Promise.all(
        flow.locations.map(async (location) => {
            location.filePath = location.uri as string;
            return location;
        })
    );
}

export function createDiagnosticFromIssue(issue: ExtendedClient.Issue) {
    const { startLine, startLineOffset, endLine, endLineOffset } = issue.textRange;
    let startPosition = coc.Position.create(0, 0);
    let endPosition = coc.Position.create(0, 0);
    let range = coc.Range.create(startPosition, endPosition);
    if (!isFileLevelIssue(issue.textRange) && startLineOffset && endLine && endLineOffset) {
        startPosition = coc.Position.create(startLine - 1, startLineOffset);
        endPosition = coc.Position.create(endLine - 1, endLineOffset);
        range = coc.Range.create(startPosition, endPosition);
    }
    const issueDiag = coc.Diagnostic.create(range, "params.message", coc.DiagnosticSeverity.Warning);
    issueDiag.code = issue.ruleKey;
    issueDiag.source = `sonarqube(${issue.ruleKey})`;
    issueDiag.message = issue.message;
    return issueDiag;
}

export function isFileLevelIssue(textRange: ExtendedClient.TextRange) {
    return textRange.startLine === 0 || textRange.endLine === 0;
}
