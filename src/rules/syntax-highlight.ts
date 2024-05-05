/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { parse } from 'node-html-parser'
import { logToSonarLintOutput } from '../util/logging'

function getNonDiffCodeSnippetsToHighlight(doc: any) {
    return doc.querySelectorAll(`pre`)
}

export function sonarToHighlightJsLanguageKeyMapping(sonarLanguageKey: string): string {
    switch (sonarLanguageKey) {
        case 'web':
            return 'html'
        case 'secrets':
            return 'markdown'
        case 'cloudformation':
        case 'kubernetes':
            return 'yaml'
        case 'ipynb':
        case 'ipython':
            return 'python'
        case 'plsql':
        case 'tsql':
            return 'sql'
        default:
            return sonarLanguageKey
    }
}

export function highlightAllCodeSnippetsInDesc(htmlDescription: string, ruleLanguageKey: string) {
    const doc = parse(htmlDescription)
    const preTagsNoDiff = getNonDiffCodeSnippetsToHighlight(doc)
    const languageKey = sonarToHighlightJsLanguageKeyMapping(ruleLanguageKey)
    const language = `language-${languageKey}`

    try {
        preTagsNoDiff.forEach((pre: any) => {
            pre.innerHTML = `<code class="${language}">${pre}</code>`
        })
    } catch (e) {
        logToSonarLintOutput(
            `Error occurred when rendering rule description. Rendering without syntax highlighting. \n ${JSON.stringify(e)}`
        )
    }

    return doc.toString()
}
