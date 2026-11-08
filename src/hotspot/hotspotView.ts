/* --------------------------------------------------------------------------------------------
 * Hotspot adapter: a remote hotspot (sonarlint/showHotspot) or a locally detected one (ShowRuleDescriptionParams
 * from sonarlint/showHotspotDetails) → htmlview input with upstream's hotspotContextPanel.ts markup: the `h1`, the
 * `dl.hotspot-header` key/value header (labels in `dd`, values in `dt`), then the rule description tabs.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import type { ExtendedClient, ShowRuleDescriptionParams } from "../lsp/protocol";
import { escapeHtml, ViewInput } from "../rules/markup";
import { classToken, renderRuleDescription, renderRuleTitle } from "../rules/ruleView";

/** The header rows of a hotspot view (plain text; escaped here). */
export interface HotspotHeader {
    /** Hotspot message, the `h1` text and the view title. */
    message: string;
    /** Security category short key (`weak-cryptography`) or `""`. */
    securityCategory: string;
    /** Review priority: the protocol enum index (0 high, 1 medium, 2 low) or a name (`High`, `low`, ...). */
    probability: number | string;
    author: string;
    status: string;
}

/** Options of {@link remoteHotspotView}. */
export interface RemoteHotspotOptions {
    /**
     * Sonar language key of the hotspot's rule (`java`), for code blocks. The remote payload carries none; default
     * {@link languageFromRuleKey} of the rule key (upstream passed `""`, so its code was never highlighted).
     */
    languageKey?: string;
}

/** Rule repositories whose name differs from the Sonar language key. */
const REPOSITORY_LANGUAGES: Readonly<Record<string, string>> = Object.freeze({
    javasecurity: "java",
    javascript: "js",
    jssecurity: "js",
    typescript: "ts",
    tssecurity: "ts",
    python: "py",
    pythonsecurity: "py",
    ipython: "ipynb",
    phpsecurity: "php",
    csharpsquid: "cs",
    "roslyn.sonaranalyzer.security.cs": "cs",
    web: "web"
});

/** The Sonar language key of a rule key's repository (`java:S4790` → `java`, `python:S1` → `py`); `""` without one. */
export function languageFromRuleKey(ruleKey: string): string {
    const separator: number = String(ruleKey ?? "").indexOf(":");
    const repository: string = separator > 0 ? ruleKey.slice(0, separator).toLowerCase() : "";
    return Object.prototype.hasOwnProperty.call(REPOSITORY_LANGUAGES, repository) ? REPOSITORY_LANGUAGES[repository] : repository;
}

const PROBABILITIES: readonly string[] = Object.freeze(["high", "medium", "low"]);

const CATEGORY_SHORT_TO_LONG: Readonly<Record<string, string>> = Object.freeze({
    "buffer-overflow": "Buffer Overflow",
    "sql-injection": "SQL Injection",
    rce: "Code Injection (RCE)",
    "object-injection": "Object Injection",
    "command-injection": "Command Injection",
    "path-traversal-injection": "Path Traversal Injection",
    "ldap-injection": "LDAP Injection",
    "xpath-injection": "XPath Injection",
    "expression-lang-injection": "Expression Language Injection",
    "log-injection": "Log Injection",
    xxe: "XML External Entity (XXE)",
    xss: "Cross-Site Scripting (XSS)",
    dos: "Denial of Service (DoS)",
    ssrf: "Server-Side Request Forgery (SSRF)",
    csrf: "Cross-Site Request Forgery (CSRF)",
    "http-response-splitting": "HTTP Response Splitting",
    "open-redirect": "Open Redirect",
    "weak-cryptography": "Weak Cryptography",
    auth: "Authentication",
    "insecure-conf": "Insecure Configuration",
    "file-manipulation": "File Manipulation",
    "encrypt-data": "Encryption of Sensitive Data",
    traceability: "Traceability",
    permission: "Permission",
    others: "Others"
});

/** `Weak Cryptography` for `weak-cryptography`; `""` for an unknown key (upstream). */
export function securityCategoryLabel(key: string): string {
    return Object.prototype.hasOwnProperty.call(CATEGORY_SHORT_TO_LONG, key) ? CATEGORY_SHORT_TO_LONG[key] : "";
}

/** `high` / `medium` / `low` from the enum index or a name in any case; `""` when it is neither. */
export function probabilityName(probability: number | string): string {
    const name: string =
        typeof probability === "number" ? (PROBABILITIES[probability] ?? "") : String(probability ?? "").toLocaleLowerCase("en-us");
    return PROBABILITIES.includes(name) ? name : "";
}

/** Upstream's `span.hotspot-probability.hotspot-probability-<name>`. */
export function renderProbability(probability: number | string): string {
    const name: string = probabilityName(probability);
    return `<span class="hotspot-probability hotspot-probability-${classToken(name)}">${escapeHtml(name)}</span>`;
}

/** The `h1` plus the `dl.hotspot-header` (Category, Review priority, Author, Status). */
export function renderHotspotHeader(header: HotspotHeader, ruleKey: string): string {
    return `${renderRuleTitle(header.message, ruleKey)}
<dl class="hotspot-header">
  <dd>Category</dd><dt>${escapeHtml(securityCategoryLabel(header.securityCategory))}</dt>
  <dd>Review priority</dd><dt>${renderProbability(header.probability)}</dt>
  <dd>Author</dd><dt>${escapeHtml(header.author)}</dt>
  <dd>Status</dd><dt>${escapeHtml(header.status)}</dt>
</dl>`;
}

/**
 * A hotspot view from its header and its rule description. The code language is the rule's `languageKey`, else
 * {@link languageFromRuleKey} of its key.
 */
export function hotspotView(header: HotspotHeader, rule: ShowRuleDescriptionParams): ViewInput {
    const html: string = `${renderHotspotHeader(header, rule.key)}\n${renderRuleDescription(rule)}`;
    return { html, lang: rule.languageKey || languageFromRuleKey(rule.key), view: "hotspot", title: header.message ?? "" };
}

/** A remote hotspot's rule as description params: the risk / assess / fix tabs (upstream). */
export function remoteHotspotRule(rule: ExtendedClient.RemoteHotspot["rule"], languageKey: string): ShowRuleDescriptionParams {
    const tab = (title: string, htmlContent: string): ShowRuleDescriptionParams["htmlDescriptionTabs"][number] => ({
        title,
        hasContextualInformation: false,
        ruleDescriptionTabNonContextual: { htmlContent: htmlContent ?? "" }
    });
    return {
        key: rule.key,
        name: rule.name,
        htmlDescription: "",
        htmlDescriptionTabs: [
            tab("What's the risk?", rule.riskDescription),
            tab("Assess the risk", rule.vulnerabilityDescription),
            tab("How can I fix it?", rule.fixRecommendations)
        ],
        severityDetails: { type: "SECURITY_HOTSPOT", severity: "" },
        isTaint: false,
        languageKey,
        parameters: []
    };
}

/** The view of a remote hotspot (sonarlint/showHotspot). */
export function remoteHotspotView(hotspot: ExtendedClient.RemoteHotspot, options: RemoteHotspotOptions = {}): ViewInput {
    const header: HotspotHeader = {
        message: hotspot.message,
        securityCategory: hotspot.rule.securityCategory,
        probability: hotspot.rule.vulnerabilityProbability,
        author: hotspot.author,
        status: hotspot.status
    };
    return hotspotView(header, remoteHotspotRule(hotspot.rule, options.languageKey ?? languageFromRuleKey(hotspot.rule.key)));
}

/** The view of a locally detected hotspot: its details keep their own `languageKey`; no category or author. */
export function localHotspotView(
    details: ShowRuleDescriptionParams,
    hotspot: { message: string; probability: number | string; status: string }
): ViewInput {
    const header: HotspotHeader = { message: hotspot.message, securityCategory: "", probability: hotspot.probability, author: "", status: hotspot.status };
    return hotspotView(header, details);
}
