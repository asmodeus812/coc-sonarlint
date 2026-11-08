/* --------------------------------------------------------------------------------------------
 * Rule description view: sonarlint/showRuleDescription → the reusable `sonarlint://rule` buffer.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";
import { ShowRuleDescriptionParams } from "../lsp/protocol";
import { SonarViews } from "../util/views";
import { ruleView } from "./ruleView";

/** The notification handler: renders the rule (with the user's current parameter values) into the rule view. */
export function showRuleDescription(views: SonarViews) {
    return async (rule: ShowRuleDescriptionParams): Promise<void> => {
        const rules: Record<string, { parameters?: Record<string, unknown> }> = coc.workspace.getConfiguration("sonarlint").get("rules", {});
        const input = ruleView(rule, { paramValues: rules?.[rule.key]?.parameters ?? {} });
        await views.show(input, { name: "sonarlint://rule", title: `${rule.key}  ${rule.name ?? ""}`.trim() });
    };
}
