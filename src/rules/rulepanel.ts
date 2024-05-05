/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as coc from "coc.nvim"
import * as md from "node-html-markdown"
import { clean, escapeHtml } from '../util/webview'
import { ShowRuleDescriptionParams } from "../lsp/protocol"
import { highlightAllCodeSnippetsInDesc } from './syntax-highlight'
const generatedRulesDescriptions: Map<string, string> = new Map()

export function showRuleDescription(factory: coc.FloatFactory) {
    return (params: ShowRuleDescriptionParams) => {
        if (!generatedRulesDescriptions.has(params.key)) {
            const text = computeRuleDescPanelContent(params)
            generatedRulesDescriptions.set(params.key, text)
        }
        const content: string = generatedRulesDescriptions.get(params.key) ?? ""
        factory.show([
            {
                filetype: "markdown",
                content: md.NodeHtmlMarkdown.translate(content),
            },
        ])
    }
}

function computeRuleDescPanelContent(rule: ShowRuleDescriptionParams) {
    const ruleParamsHtml = renderRuleParams(rule)
    const taintBanner = renderTaintBanner(rule)
    const hotspotBanner = renderHotspotBanner(rule)
    const ruleDescription = renderRuleDescription(rule)

    return `<!doctype html><html lang="en">
        <head>
            <title>${escapeHtml(rule.name)}</title>
            <meta http-equiv="Content-Type" content="text/html;charset=utf-8" />
        </head>
        <body>
            <h1><big>${escapeHtml(rule.name)}</big> (${rule.key})</h1>
            ${renderTaxonomyInfo(rule)}
            ${taintBanner}
            ${hotspotBanner}
            ${ruleDescription}
            ${ruleParamsHtml}
        </body></html>`
}

function renderCleanCodeAttribute(rule: ShowRuleDescriptionParams) {
    const categoryLabel = escapeHtml(rule.cleanCodeAttributeCategory)
    const attributeLabel = escapeHtml(rule.cleanCodeAttribute)
    return `<div>
                <span>${categoryLabel} issue</span>
                <span>${attributeLabel}</span>
            </div>`
}

function renderImpact(softwareQuality: string, severity: string) {
    const softwareQualityLowerCase = softwareQuality.toLocaleLowerCase('en-us')
    const impactSeverityLowerCase = severity.toLocaleLowerCase('en-us')
    const formattedImpact = `Issues found for this rule will have a ${impactSeverityLowerCase} impact on the ${softwareQualityLowerCase} of your software.`
    return `<div><span>${formattedImpact}</span></div>`
}

function renderTaxonomyInfo(rule: ShowRuleDescriptionParams) {
    if (rule.impacts && Object.keys(rule.impacts).length > 0) {
        const renderedImpacts = Object.entries(rule.impacts).map(([softwareQuality, severity]) => renderImpact(softwareQuality, severity))
        return `<div>
            ${renderCleanCodeAttribute(rule)}
            &nbsp;
            ${renderedImpacts.join('&nbsp;')}
            &nbsp;
            </div>`
    } else {
        return `<div>
            <div>
                ${clean(rule.type)}
            </div>
            <div>
                ${clean(rule.severity)}
            </div>
            </div>`
    }
}

export function renderTaintBanner(rule: ShowRuleDescriptionParams) {
    if (!rule.isTaint) {
        return ''
    }
    return `<div>
            This injection vulnerability was detected by the latest SonarQube or SonarCloud analysis.
             SonarLint fetches and reports it in your local code to help you investigate it and fix it,
              but cannot tell you whether you successfully fixed it. To verify your fix, please ensure
              the code containing your fix is analyzed by SonarQube or SonarCloud.
            </p>
           </div>`
}

export function renderHotspotBanner(rule: ShowRuleDescriptionParams) {
    if (rule.type !== 'SECURITY_HOTSPOT') {
        return ''
    }
    return `<div>
            A security hotspot highlights a security-sensitive piece of code that the developer <b>needs to review</b>.
            Upon review, you'll either find there is no threat or you need to apply a fix to secure the code.
            In order to set the review output for a hotspot, please right-click on the hotspot and select the
            'Review on Server' option.
            </p>
           </div>`
}

export function renderRuleDescription(rule: ShowRuleDescriptionParams) {
    if (rule.htmlDescriptionTabs.length === 0) {
        const newDesc = highlightAllCodeSnippetsInDesc(rule.htmlDescription, rule.languageKey)
        return `<div>${newDesc}</div>`
    } else {
        const tabsContent = rule.htmlDescriptionTabs
            .map((tab, index) => {
                let content: any
                if (tab.hasContextualInformation) {
                    content = computeTabContextualDescription(tab, rule.languageKey)
                } else {
                    content = highlightAllCodeSnippetsInDesc(tab.ruleDescriptionTabNonContextual?.htmlContent, rule.languageKey)
                    content = `<div>${content}</div>`
                }
                return `<label for="tab-${index}">${tab.title}</label>
                    <section>
                    ${content}
                    </section>`
            })
            .join('')
        return `<main>${tabsContent}</main>`
    }
}

function computeTabContextualDescription(tab: any, languageKey: string) {
    const contextRadioButtons = tab.ruleDescriptionTabContextual.map((contextualDescription: any, contextIndex: any) => {
        const newContent = highlightAllCodeSnippetsInDesc(
            contextualDescription.htmlContent,
            languageKey)
        return `<label for="context-${contextIndex}">${contextualDescription.displayName}</label>
              <section>
              <h4>${computeHeading(tab, contextualDescription)}</h4>
                <div>
                ${newContent}
                </div>
              </section>`
    })
    return contextRadioButtons.join('')
}

export function computeHeading(tab: any, contextualDescription: any) {
    const trimmedTabTitle = tab.title.endsWith('?') ? tab.title.substring(0, tab.title.length - 1) : tab.title
    return contextualDescription.contextKey === 'others'
        ? ''
        : `${trimmedTabTitle} in ${contextualDescription.displayName}`
}

export function renderRuleParams(rule: ShowRuleDescriptionParams) {
    if (rule.parameters && rule.parameters.length > 0) {
        const ruleParamsConfig = coc.workspace.getConfiguration(`sonarlint.rules.${rule.key}.parameters`)
        return `<table>
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
                ${rule.parameters.map(p => renderRuleParam(p, ruleParamsConfig)).join('\n')}
            </tbody>
            </table>`
    } else {
        return ''
    }
}

export function renderRuleParam(param: any, config: any) {
    const { name, description, defaultValue } = param
    const descriptionP = description ? `<p>${description}</p>` : ''
    const currentValue = config.has(name) ? `<small>Current value: <code>${config.get(name)}</code></small>` : ''
    const defaultRendered = defaultValue ? `<small>(Default value: <code>${defaultValue}</code>)</small>` : ''
    return `<tr>
        <th>${name}</th>
        <td>
            ${descriptionP}
            ${currentValue}
            ${defaultRendered}
        </td>
        </tr>`
}
