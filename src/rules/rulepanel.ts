/* --------------------------------------------------------------------------------------------
 * SonarLint Rule HTML (no VS Code Webview)
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { FloatFactory } from "coc.nvim";
import { capitalize } from "lodash";
import { ShowRuleDescriptionParams } from "../lsp/protocol";
import { renderRuleHtmlWithCss } from "../util/htmlRenderer";
import * as util from "../util/util";
import { clean, escapeHtml, showWebView } from "../util/webview";
import { decorateContextualHtmlContentWithDiff } from "./code-diff";
import { highlightAllCodeSnippetsInDesc } from "./syntax-highlight";

export function showRuleDescription(factory: FloatFactory) {
    return async (rule: ShowRuleDescriptionParams) => {
        const text = renderRuleHtml(rule);
        const result = await renderRuleHtmlWithCss(text);
        await showWebView(factory, result.text, result.highlights);
    };
}

export function renderRuleHtml(rule: ShowRuleDescriptionParams) {
    // Resolve static assets (same filenames as before)
    const themeSrc = util.resolveExtensionFile("styles", "theme.css");
    const styleSrc = util.resolveExtensionFile("styles", "rule.css");
    const hljsSrc = util.resolveExtensionFile("styles", "vs.css");
    const hotspotSrc = util.resolveExtensionFile("styles", "hotspot.css");
    const infoImgSrc = util.resolveExtensionFile("images", "info.png");

    const ruleParamsHtml = renderRuleParams(rule);

    const taintBanner = renderTaintBanner(rule, infoImgSrc.fsPath);
    const hotspotBanner = renderHotspotBanner(rule, infoImgSrc.fsPath);
    const ruleDescription = renderRuleDescription(rule);

    return `<!doctype html><html lang="en">
    <head>
    <title>${escapeHtml(rule.name)}</title>
    <meta http-equiv="Content-Type" content="text/html;charset=utf-8" />
    <link rel="stylesheet" type="text/css" href="${themeSrc.fsPath}" />
    <link rel="stylesheet" type="text/css" href="${styleSrc.fsPath}" />
    <link rel="stylesheet" type="text/css" href="${hotspotSrc.fsPath}" />
    <link rel="stylesheet" type="text/css" href="${hljsSrc.fsPath}" />
    </head>
    <body>
    <h1><big>${escapeHtml(rule.name)}</big> (${rule.key})</h1>
    ${renderTaxonomyInfo(rule)}
    ${taintBanner}
    ${hotspotBanner}
    ${ruleDescription}
    ${ruleParamsHtml}
    </body></html>`;
}

function renderCleanCodeAttribute(rule: ShowRuleDescriptionParams) {
    const categoryLabel = escapeHtml(rule?.severityDetails?.cleanCodeAttributeCategory as string);
    const attributeLabel = escapeHtml(rule?.severityDetails?.cleanCodeAttribute as string);
    return `<div class="clean-code-attribute capsule" title="Coding attributes are characteristics that, when followed, ensure strong code quality and security.">
  <span class="attribute-category">${categoryLabel} issue</span>
  <span class="attribute">${attributeLabel}</span>
</div>`;
}

function renderImpact(softwareQuality: string, severity: string) {
    const softwareQualityLowerCase = softwareQuality.toLocaleLowerCase("en-us");
    const impactSeverityLowerCase = severity.toLocaleLowerCase("en-us");
    const impactSeverityImgSrc = util.resolveExtensionFile("images", "impact", `${impactSeverityLowerCase}.svg`);
    const formattedImpact = `Issues found for this rule will have a ${impactSeverityLowerCase} impact on the ${softwareQualityLowerCase} of your software.`;
    return `<div class="impact impact-${impactSeverityLowerCase} capsule" title="${formattedImpact}">
  <span>${capitalize(softwareQualityLowerCase)}</span>
  <img alt="${capitalize(impactSeverityLowerCase)}" src="${impactSeverityImgSrc.fsPath}" />
</div>`;
}

const severityToImpact = {
    info: "info",
    minor: "low",
    major: "medium",
    critical: "high",
    blocker: "blocker"
};

function renderStandardModeSeverityDetails(ruleType: string, severity: string) {
    const ruleTypeToLowerCase = ruleType.toLocaleLowerCase("en-us");
    const severityToLowerCase = severity.toLocaleLowerCase("en-us");
    const ruleTypeSvgPath = util.resolveExtensionFile("images", "type", `${ruleTypeToLowerCase}.svg`).fsPath;
    const severitySvgPath = util.resolveExtensionFile("images", "impact", `${severityToImpact[severityToLowerCase]}.svg`).fsPath;
    const formattedDescription = `${escapeHtml(severityToLowerCase)} ${escapeHtml(ruleTypeToLowerCase.replace(/_/g, " "))}`;
    return `<div class="impact severity-${severityToLowerCase} capsule" title="${formattedDescription}">
  ${fetchSVGIcon(ruleTypeSvgPath)}
  &nbsp;${clean(ruleType)}&nbsp;
  ${fetchSVGIcon(severitySvgPath)}
  </div>`;
}

function fetchSVGIcon(_pathToSVG: string): string {
    // try {
    // const svgText = fs.readFileSync(pathToSVG, "utf8");
    // const parser: DOMParser = new DOMParser();
    // const svgDoc = parser.parseFromString(svgText, "image/svg+xml");
    // const svgElement = svgDoc.documentElement;
    // return new XMLSerializer().serializeToString(svgElement);
    // } catch (error) {
    // }
    return "";
}

function renderTaxonomyInfo(rule: ShowRuleDescriptionParams) {
    if (rule.severityDetails.impacts && Object.keys(rule.severityDetails.impacts).length > 0) {
        // Clean Code taxonomy
        const renderedImpacts = Object.entries(rule.severityDetails.impacts).map(([softwareQuality, severity]) =>
            renderImpact(softwareQuality, severity)
        );
        return `<div class="taxonomy">
      ${renderCleanCodeAttribute(rule)}
      &nbsp;
      ${renderedImpacts.join("&nbsp;")}
    </div>`;
    } else {
        // Old type + severity taxonomy
        return `<div class="taxonomy">
      ${renderStandardModeSeverityDetails(rule.severityDetails.type as string, rule.severityDetails.severity as string)}
</div>`;
    }
}

export function renderTaintBanner(rule: ShowRuleDescriptionParams, infoImgSrc: string) {
    if (!rule.isTaint) {
        return "";
    }
    return `<div class="info-banner-wrapper">
            <p class="info-banner"><span><img src=${infoImgSrc} alt="info"></span>
            This injection vulnerability was detected by the latest SonarQube (Server, Cloud) analysis.
             SonarQube for VS Code fetches and reports it in your local code to help you investigate it and fix it,
              but cannot tell you whether you successfully fixed it. To verify your fix, please ensure
              the code containing your fix is analyzed by SonarQube (Server, Cloud).
            </p>
           </div>`;
}

export function renderHotspotBanner(rule: ShowRuleDescriptionParams, infoImgSrc: string) {
    if (rule.severityDetails.type !== "SECURITY_HOTSPOT") {
        return "";
    }
    return `<div class="info-banner-wrapper">
            <p class="info-banner"><span><img src=${infoImgSrc} alt="info"></span>
            A security hotspot highlights a security-sensitive piece of code that the developer <b>needs to review</b>.
            Upon review, you'll either find there is no threat or you need to apply a fix to secure the code.
            In order to set the review output for a hotspot, please right-click on the hotspot and select the
            'Review on Server' option.
            </p>
           </div>`;
}

export function renderRuleDescription(rule: ShowRuleDescriptionParams) {
    if (rule.htmlDescriptionTabs.length === 0) {
        const newDesc = highlightAllCodeSnippetsInDesc(rule.htmlDescription, rule.languageKey, false);
        return `<div class="rule-desc">${newDesc}</div>`;
    } else {
        const tabsContent = rule.htmlDescriptionTabs
            .map((tab, index) => {
                let content: string;
                if (tab.hasContextualInformation) {
                    content = computeTabContextualDescription(tab, rule.languageKey);
                } else {
                    content = highlightAllCodeSnippetsInDesc(
                        decorateContextualHtmlContentWithDiff(tab.ruleDescriptionTabNonContextual?.htmlContent as string),
                        rule.languageKey,
                        true
                    );
                    content = `<div class='rule-desc'>${content}</div>`;
                }
                return `<input type="radio" name="tabs" id="tab-${index}" ${index === 0 ? 'checked="checked"' : ""}>
        <label for="tab-${index}" class="tabLabel">${tab.title}</label>
        <section class="tab${tab.hasContextualInformation ? " contextualTabContainer" : ""}">
          ${content}
        </section>`;
            })
            .join("");
        return `<main class="tabs">${tabsContent}</main>`;
    }
}

function computeTabContextualDescription(tab, languageKey) {
    const defaultContextKey = tab.defaultContextKey ? tab.defaultContextKey : "others";
    const contextRadioButtons = tab.ruleDescriptionTabContextual.map((contextualDescription, contextIndex) => {
        const checked = isChecked(contextualDescription, defaultContextKey);
        const newContent = highlightAllCodeSnippetsInDesc(
            decorateContextualHtmlContentWithDiff(contextualDescription.htmlContent),
            languageKey,
            true
        );
        return `<input type="radio" name="contextualTabs" id="context-${contextIndex}"
                        class="contextualTab" ${checked}>
              <label for="context-${contextIndex}" class="contextLabel">${contextualDescription.displayName}</label>
              <section class="tab">
              <h4>${computeHeading(tab, contextualDescription)}</h4>
                <div class="rule-desc">
                ${newContent}
                </div>
              </section>`;
    });
    return contextRadioButtons.join("");
}

function isChecked(contextualDescription: { contextKey: any }, defaultContextKey: string) {
    if (`${contextualDescription.contextKey}` === defaultContextKey) {
        return 'checked="checked"';
    }
    return "";
}

export function computeHeading(tab: { title: string }, contextualDescription: { contextKey: string; displayName: any }) {
    const trimmedTabTitle = tab.title.endsWith("?") ? tab.title.substring(0, tab.title.length - 1) : tab.title;
    return contextualDescription.contextKey === "others" ? "" : `${trimmedTabTitle} in ${contextualDescription.displayName}`;
}

export function renderRuleParams(rule: ShowRuleDescriptionParams) {
    if (rule.parameters && rule.parameters.length > 0) {
        // VS Code config removed; keep structure. Current values will only appear
        // if you later swap this for a real config object with .has/.get().
        const ruleParamsConfig: { has: (k: string) => boolean; get: (k: string) => unknown } = {
            has: () => false,
            get: () => undefined
        };

        return `<table class="rule-params">
  <caption>Parameters</caption>
  <thead>
    <tr>
      <td colspan="2">
        Following parameter values can be set in the <em>SonarLint:Rules</em> user settings.
        In connected mode, server side configuration overrides local settings.
      </td>
    </tr>
  </thead>
  <tbody>
    ${rule.parameters.map((p) => renderRuleParam(p, ruleParamsConfig)).join("\n")}
  </tbody>
</table>`;
    } else {
        return "";
    }
}

export function renderRuleParam(param: { name: any; description: any; defaultValue: any }, config: { has: any; get: any }) {
    const { name, description, defaultValue } = param;
    const descriptionP = description ? `<p>${description}</p>` : "";
    const currentValue = config?.has(name) ? `<small>Current value: <code>${config.get(name)}</code></small>` : "";
    const defaultRendered = defaultValue ? `<small>(Default value: <code>${defaultValue}</code>)</small>` : "";
    return `<tr>
  <th>${name}</th>
  <td>
    ${descriptionP}
    ${currentValue}
    ${defaultRendered}
  </td>
</tr>`;
}
