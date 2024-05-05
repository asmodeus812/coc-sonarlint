/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
}

export function escapeHtml(str?: string) {
    return String(str).replace(/[&<>"'/`=]/g, function(s) {
        return entityMap[s]
    })
}

export function clean(str?: string) {
    return capitalizeName(String(str).toLowerCase().split('_').join(' '))
}

export function capitalizeName(name?: string) {
    return String(name).replace(/\b(\w)/g, s => s.toUpperCase())
}

