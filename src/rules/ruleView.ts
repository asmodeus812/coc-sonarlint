/* --------------------------------------------------------------------------------------------
 * Rule description adapter: ShowRuleDescriptionParams → htmlview input (upstream rulepanel.ts markup).
 *
 * Emits the markup upstream's templates emit, with the same class names, so upstream's sheets apply and htmlview's
 * parser recognises tabs (`main.tabs`), contexts (`contextualTab`/`contextLabel`), capsules and diff pairs. Server
 * HTML content (descriptions) is passed through untouched: htmlview parses it, splits diff pairs and highlights
 * code itself, so nothing is pre-decorated or pre-highlighted here. Every server text field is escaped.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import type { ShowRuleDescriptionParams } from "../lsp/protocol";
import { capitalize, escapeHtml, ViewInput } from "./markup";

type RuleTab = ShowRuleDescriptionParams["htmlDescriptionTabs"][number];
type RuleContext = NonNullable<RuleTab["ruleDescriptionTabContextual"]>[number];
type RuleParam = NonNullable<ShowRuleDescriptionParams["parameters"]>[number];

/** Options of {@link ruleView}. */
export interface RuleViewOptions {
    /** Current rule parameter values from the user settings (`sonarlint.rules[key].parameters`), by name. */
    paramValues?: Record<string, unknown>;
}

/** The whole rule view: header, taxonomy, banners, description (tabs/contexts) and the parameters table. */
export function ruleView(rule: ShowRuleDescriptionParams, options: RuleViewOptions = {}): ViewInput {
    const html: string = [
        renderRuleTitle(rule.name, rule.key),
        renderTaxonomyInfo(rule),
        renderTaintBanner(rule),
        renderHotspotBanner(rule),
        renderRuleDescription(rule),
        renderRuleParams(rule, options.paramValues)
    ]
        .filter((part: string): boolean => part !== "")
        .join("\n");
    return { html, lang: rule.languageKey ?? "", view: "rule", title: rule.name ?? "" };
}

/** `<h1><big>name</big> (key)</h1>`, both escaped. */
export function renderRuleTitle(name: string, key: string): string {
    return `<h1><big>${escapeHtml(name)}</big> (${escapeHtml(key)})</h1>`;
}

/** A server value made safe as one class-name token (`MAJOR` → `major`, anything else odd → `-`). */
export function classToken(value: unknown): string {
    return lower(value).replace(/[^a-z0-9_-]/g, "-");
}

/** `value` as lower-case text; `null`/`undefined` become `""`. */
function lower(value: unknown): string {
    return String(value ?? "").toLocaleLowerCase("en-us");
}

/** `CODE_SMELL` → `Code Smell` (upstream `clean`). */
function cleanLabel(value: string): string {
    return value
        .toLowerCase()
        .split("_")
        .join(" ")
        .replace(/\b(\w)/g, (s: string): string => s.toUpperCase());
}

function renderCleanCodeAttribute(rule: ShowRuleDescriptionParams): string {
    const category: string = escapeHtml(rule.severityDetails?.cleanCodeAttributeCategory);
    const attribute: string = escapeHtml(rule.severityDetails?.cleanCodeAttribute);
    return `<div class="clean-code-attribute capsule" title="Coding attributes are characteristics that, when followed, ensure strong code quality and security.">
  <span class="attribute-category">${category} issue</span>
  <span class="attribute">${attribute}</span>
</div>`;
}

function renderImpact(softwareQuality: string, severity: string): string {
    const quality: string = lower(softwareQuality);
    const level: string = lower(severity);
    const title: string = `Issues found for this rule will have a ${level} impact on the ${quality} of your software.`;
    return `<div class="impact impact-${classToken(level)} capsule" title="${escapeHtml(title)}">
  <span>${escapeHtml(capitalize(quality))}</span>
  <img alt="${escapeHtml(capitalize(level))}" />
</div>`;
}

function renderStandardSeverity(ruleType: string, severity: string): string {
    const type: string = lower(ruleType);
    const level: string = lower(severity);
    const title: string = `${level} ${type.replace(/_/g, " ")}`;
    return `<div class="impact severity-${classToken(level)} capsule" title="${escapeHtml(title)}">
  &nbsp;${escapeHtml(cleanLabel(type))}&nbsp;
</div>`;
}

/** The `div.taxonomy` capsules: clean code attribute plus impacts, or the standard mode type + severity. */
export function renderTaxonomyInfo(rule: ShowRuleDescriptionParams): string {
    const impacts: Record<string, string> = rule.severityDetails?.impacts ?? {};
    const entries: Array<[string, string]> = Object.entries(impacts);
    const capsules: string =
        entries.length > 0
            ? `${renderCleanCodeAttribute(rule)}\n&nbsp;\n${entries.map(([q, s]) => renderImpact(q, s)).join("&nbsp;")}`
            : renderStandardSeverity(rule.severityDetails?.type ?? "", rule.severityDetails?.severity ?? "");
    return `<div class="taxonomy">\n${capsules}\n</div>`;
}

function renderInfoBanner(body: string): string {
    return `<div class="info-banner-wrapper">
<p class="info-banner"><span><img alt="info" /></span>
${body}
</p>
</div>`;
}

/** Upstream's taint vulnerability banner, or `""` when the rule is not a taint one. */
export function renderTaintBanner(rule: ShowRuleDescriptionParams): string {
    return rule.isTaint
        ? renderInfoBanner(`This injection vulnerability was detected by the latest SonarQube (Server, Cloud) analysis.
SonarQube for VS Code fetches and reports it in your local code to help you investigate it and fix it,
but cannot tell you whether you successfully fixed it. To verify your fix, please ensure
the code containing your fix is analyzed by SonarQube (Server, Cloud).`)
        : "";
}

/** Upstream's security hotspot banner, or `""` when the rule is not a hotspot rule. */
export function renderHotspotBanner(rule: ShowRuleDescriptionParams): string {
    return rule.severityDetails?.type === "SECURITY_HOTSPOT"
        ? renderInfoBanner(`A security hotspot highlights a security-sensitive piece of code that the developer <b>needs to review</b>.
Upon review, you'll either find there is no threat or you need to apply a fix to secure the code.
In order to set the review output for a hotspot, please right-click on the hotspot and select the
'Review on Server' option.`)
        : "";
}

/**
 * The description: `div.rule-desc` for a monolithic one, else `main.tabs` with one radio + `label.tabLabel` +
 * `section.tab` per tab (the first checked). Contextual tabs nest the contexts (see {@link renderContexts}).
 */
export function renderRuleDescription(rule: ShowRuleDescriptionParams): string {
    const tabs: RuleTab[] = rule.htmlDescriptionTabs ?? [];
    return tabs.length === 0
        ? `<div class="rule-desc">${rule.htmlDescription ?? ""}</div>`
        : `<main class="tabs">${tabs.map(renderTab).join("")}</main>`;
}

function renderTab(tab: RuleTab, index: number): string {
    const contextual: boolean = tab.hasContextualInformation === true;
    const content: string = contextual
        ? renderContexts(tab)
        : `<div class="rule-desc">${tab.ruleDescriptionTabNonContextual?.htmlContent ?? ""}</div>`;
    const checked: string = index === 0 ? ' checked="checked"' : "";
    const sectionClass: string = contextual ? "tab contextualTabContainer" : "tab";
    const defaultKey: string = contextual ? ` data-default-context-key="${escapeHtml(defaultContextKey(tab))}"` : "";
    return `<input type="radio" name="tabs" id="tab-${index}"${checked}>
<label for="tab-${index}" class="tabLabel">${escapeHtml(tab.title)}</label>
<section class="${sectionClass}"${defaultKey}>
${content}
</section>`;
}

/** The server's default context, `others` when it names none (upstream). */
export function defaultContextKey(tab: RuleTab): string {
    return tab.defaultContextKey ? tab.defaultContextKey : "others";
}

/**
 * Upstream's contexts: per context a radio `input.contextualTab` (checked for the default context),
 * `label.contextLabel` and `section.tab` holding the `h4` heading and the `div.rule-desc` content. The Sonar context
 * key rides along as `data-context-key` on the input and the label (upstream's markup has only the index).
 */
export function renderContexts(tab: RuleTab): string {
    const fallback: string = defaultContextKey(tab);
    return (tab.ruleDescriptionTabContextual ?? [])
        .map((context: RuleContext, index: number): string => {
            const key: string = escapeHtml(context.contextKey);
            const checked: string = `${context.contextKey}` === fallback ? ' checked="checked"' : "";
            return `<input type="radio" name="contextualTabs" id="context-${index}" class="contextualTab" data-context-key="${key}"${checked}>
<label for="context-${index}" class="contextLabel" data-context-key="${key}">${escapeHtml(context.displayName)}</label>
<section class="tab">
<h4>${escapeHtml(contextHeading(tab.title, context))}</h4>
<div class="rule-desc">
${context.htmlContent ?? ""}
</div>
</section>`;
        })
        .join("");
}

/** `How to fix it in JSP` (the trailing `?` dropped); `""` for the `others` context (upstream `computeHeading`). */
export function contextHeading(tabTitle: string, context: Pick<RuleContext, "contextKey" | "displayName">): string {
    const title: string = tabTitle.endsWith("?") ? tabTitle.substring(0, tabTitle.length - 1) : tabTitle;
    return context.contextKey === "others" ? "" : `${title} in ${context.displayName}`;
}

/** Upstream's `table.rule-params`, or `""` without parameters. Current values come from `paramValues`. */
export function renderRuleParams(rule: ShowRuleDescriptionParams, paramValues: Record<string, unknown> = {}): string {
    const params: RuleParam[] = rule.parameters ?? [];
    return params.length > 0
        ? `<table class="rule-params">
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
${params.map((p: RuleParam): string => renderRuleParam(p, paramValues)).join("\n")}
  </tbody>
</table>`
        : "";
}

function renderRuleParam(param: RuleParam, paramValues: Record<string, unknown>): string {
    const has: boolean = Object.prototype.hasOwnProperty.call(paramValues, param.name);
    const description: string = param.description ? `<p>${escapeHtml(param.description)}</p>` : "";
    const current: string = has ? `<small>Current value: <code>${escapeHtml(paramValues[param.name])}</code></small>` : "";
    const fallback: string = param.defaultValue ? `<small>(Default value: <code>${escapeHtml(param.defaultValue)}</code>)</small>` : "";
    return `<tr>
  <th>${escapeHtml(param.name)}</th>
  <td>
    ${[description, current, fallback].filter((s: string): boolean => s !== "").join("\n    ")}
  </td>
</tr>`;
}
