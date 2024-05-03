/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as coc from "coc.nvim";
import { ShowRuleDescriptionParams } from "../lsp/protocol";

export function showRuleDescription(factory: coc.FloatFactory) {
    return (params: ShowRuleDescriptionParams) => {
        factory.show([
            {
                filetype: "markdown",
                content: computeRuleDescPanelContent(params),
            },
        ]);
    };
}

function computeRuleDescPanelContent(rule: ShowRuleDescriptionParams) {
    const ruleParameters = renderRuleParams(rule);
    const ruleDescription = renderRuleDescription(rule);

    return `${rule.name} (${rule.key})\n
            ${ruleDescription}\n
            ${ruleParameters}\n`;
}

export function renderRuleDescription(rule: ShowRuleDescriptionParams) {
    if (rule.htmlDescriptionTabs.length === 0) {
        return `${rule.htmlDescription}`;
    } else {
        const tabsContent = rule.htmlDescriptionTabs
            .map((tab, _) => {
                let content: string | undefined;
                if (tab.hasContextualInformation) {
                    content = computeTabContextualDescription(tab);
                } else {
                    content = tab?.ruleDescriptionTabNonContextual?.htmlContent;
                }
                return `${tab.title}\n${content} `;
            })
            .join("\n");
        return `${tabsContent}`;
    }
}

function computeTabContextualDescription(tab: any) {
    const contextRadioButtons = tab.ruleDescriptionTabContextual.map(
        (contextualDescription: any) => {
            return `${computeHeading(tab, contextualDescription)}\n${contextualDescription.htmlContent}`;
        },
    );
    return contextRadioButtons.join("");
}

export function computeHeading(tab: any, contextualDescription: any) {
    const trimmedTabTitle = tab.title.endsWith("?")
        ? tab.title.substring(0, tab.title.length - 1)
        : tab.title;
    return contextualDescription.contextKey === "others"
        ? ""
        : `${trimmedTabTitle} in ${contextualDescription.displayName}`;
}

export function renderRuleParams(rule: ShowRuleDescriptionParams) {
    if (rule.parameters && rule.parameters.length > 0) {
        const ruleParamsConfig = coc.workspace.getConfiguration(
            `sonarlint.rules.${rule.key}.parameters`,
        );
        return `Following parameter values can be set in the SonarLint:Rules user settings.
                ${rule.parameters.map((p) => renderRuleParam(p, ruleParamsConfig)).join("\n")}`;
    } else {
        return "";
    }
}

export function renderRuleParam(
    param: any,
    config: coc.WorkspaceConfiguration,
) {
    const { name, description, defaultValue } = param;
    const descriptionP = description ? `${description}` : "";
    const currentValue = config.has(name) ? `Current: ${config.get(name)}` : "";
    const defaultRendered = defaultValue ? `Default: ${defaultValue}` : "";
    return `${name}\n
            ${descriptionP}\n
            ${currentValue}\n
            ${defaultRendered}\n`;
}
