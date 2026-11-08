import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ShowRuleDescriptionParams } from "../../src/lsp/protocol";
import { loadFixture } from "../fixtures";
import { escapeHtml, sheetPaths, VIEW_SHEETS } from "../../src/rules/markup";
import { contextHeading, renderRuleParams, ruleView } from "../../src/rules/ruleView";

const EVIL: string = `<script>alert("x")</script>&'`;
const EVIL_ESCAPED: string = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;";

function baseRule(overrides: Partial<ShowRuleDescriptionParams> = {}): ShowRuleDescriptionParams {
    return {
        key: "java:S1192",
        name: "String literals should not be duplicated",
        htmlDescription: "<p>monolithicDescription</p>",
        htmlDescriptionTabs: [],
        severityDetails: { severity: "MAJOR", type: "CODE_SMELL" },
        languageKey: "java",
        isTaint: false,
        ...overrides
    };
}

/** upstream test/suite/rulepanel.test.ts:37-66 (default context `jsp`). */
function contextualRule(): ShowRuleDescriptionParams {
    return baseRule({
        isTaint: true,
        htmlDescriptionTabs: [
            {
                title: "Title",
                hasContextualInformation: true,
                defaultContextKey: "jsp",
                ruleDescriptionTabContextual: [
                    { htmlContent: "<p>context 1</p>", contextKey: "servlet", displayName: "Servlet" },
                    { htmlContent: "<p>context 2</p>", contextKey: "jsp", displayName: "JSP" }
                ]
            }
        ]
    });
}

test("escapeHtml escapes the five HTML specials and nullish values", () => {
    assert.equal(escapeHtml(EVIL), EVIL_ESCAPED);
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml(null), "");
});

test("rule header escapes key and name; monolithic description is kept in div.rule-desc", () => {
    const view = ruleView(baseRule({ key: `k"<`, name: EVIL }));
    assert.ok(view.html.startsWith(`<h1><big>${EVIL_ESCAPED}</big> (k&quot;&lt;)</h1>`));
    assert.ok(view.html.includes('<div class="rule-desc"><p>monolithicDescription</p></div>'));
    assert.ok(!view.html.includes("<script>"));
    assert.equal(view.title, EVIL);
    assert.equal(view.view, "rule");
    assert.equal(view.lang, "java");
});

test("standard mode taxonomy: severity capsule with upstream classes", () => {
    const html = ruleView(baseRule()).html;
    assert.ok(html.includes('<div class="taxonomy">'));
    assert.ok(html.includes('<div class="impact severity-major capsule" title="major code smell">'));
    assert.ok(html.includes("&nbsp;Code Smell&nbsp;"));
});

test("clean code taxonomy: attribute capsule and one impact capsule per quality, escaped", () => {
    const html = ruleView(
        baseRule({
            severityDetails: {
                cleanCodeAttributeCategory: "ADAPTABLE<",
                cleanCodeAttribute: "DISTINCT",
                impacts: { MAINTAINABILITY: "HIGH", RELIABILITY: "LOW", '"><x': "MEDIUM" }
            }
        })
    ).html;
    assert.ok(html.includes('<div class="clean-code-attribute capsule"'));
    assert.ok(html.includes('<span class="attribute-category">ADAPTABLE&lt; issue</span>'));
    assert.ok(html.includes('<span class="attribute">DISTINCT</span>'));
    assert.ok(html.includes('<div class="impact impact-high capsule" title="Issues found for this rule will have a high impact on the maintainability of your software.">'));
    assert.ok(html.includes("<span>Maintainability</span>"));
    assert.ok(html.includes('<img alt="High" />'));
    assert.ok(html.includes('<div class="impact impact-low capsule"'));
    assert.ok(html.includes("<span>&quot;&gt;&lt;x</span>"));
    assert.ok(!html.includes('"><x'));
});

test("severity class token is sanitised", () => {
    const html = ruleView(baseRule({ severityDetails: { severity: 'x" onload="y', type: "BUG" } })).html;
    assert.ok(html.includes('class="impact severity-x--onload--y capsule"'));
});

test("taint and hotspot banners appear only when applicable", () => {
    const plain = ruleView(baseRule()).html;
    assert.ok(!plain.includes("info-banner"));
    const taint = ruleView(baseRule({ isTaint: true })).html;
    assert.ok(taint.includes('<div class="info-banner-wrapper">\n<p class="info-banner">'));
    assert.ok(taint.includes("This injection vulnerability"));
    const hotspot = ruleView(baseRule({ severityDetails: { type: "SECURITY_HOTSPOT", severity: "" } })).html;
    assert.ok(hotspot.includes("A security hotspot highlights"));
    assert.ok(hotspot.includes("<b>needs to review</b>"));
    assert.ok(!hotspot.includes("This injection vulnerability"));
});

test("tabs: main.tabs with radio, label.tabLabel and section.tab per tab, first checked, titles escaped", () => {
    const rule = baseRule({
        htmlDescriptionTabs: [
            { title: "Why is this an issue?", hasContextualInformation: false, ruleDescriptionTabNonContextual: { htmlContent: "<p>why</p>" } },
            { title: "<Resources>", hasContextualInformation: false, ruleDescriptionTabNonContextual: { htmlContent: "<p>res</p>" } }
        ]
    });
    const html = ruleView(rule).html;
    assert.match(html, /<main class="tabs">[\s\S]*<\/main>$/);
    assert.ok(html.includes('<input type="radio" name="tabs" id="tab-0" checked="checked">\n<label for="tab-0" class="tabLabel">Why is this an issue?</label>\n<section class="tab">'));
    assert.ok(html.includes('<input type="radio" name="tabs" id="tab-1">\n<label for="tab-1" class="tabLabel">&lt;Resources&gt;</label>'));
    assert.ok(html.includes('<div class="rule-desc"><p>why</p></div>'));
    assert.equal(html.match(/<section class="tab">/g)?.length, 2);
});

test("contexts: default context checked, context keys carried, headings and names escaped", () => {
    const html = ruleView(contextualRule()).html;
    const inline = html.replace(/\r?\n/g, "");
    // upstream's assertion (rulepanel.test.ts:69), adapted to our whitespace and data attributes
    assert.match(inline, /<input type="radio" name="tabs".*class="contextualTab" data-context-key="jsp" checked="checked"><label for="context-1" class="contextLabel" data-context-key="jsp">JSP<\/label>/);
    assert.ok(html.includes('<section class="tab contextualTabContainer" data-default-context-key="jsp">'));
    assert.ok(html.includes('id="context-0" class="contextualTab" data-context-key="servlet">'));
    assert.equal(html.match(/checked="checked"/g)?.length, 2); // tab-0 and the jsp context
    assert.ok(html.includes("<h4>Title in Servlet</h4>"));
    assert.ok(html.includes('<div class="rule-desc">\n<p>context 2</p>\n</div>'));
    assert.ok(html.includes("This injection vulnerability")); // isTaint in upstream's data
});

test("contexts: missing defaultContextKey falls back to `others`, whose heading is empty", () => {
    const rule = baseRule({
        htmlDescriptionTabs: [
            {
                title: "How can I fix it?",
                hasContextualInformation: true,
                ruleDescriptionTabContextual: [
                    { htmlContent: "<p>a</p>", contextKey: "spring", displayName: "Spring<" },
                    { htmlContent: "<p>b</p>", contextKey: "others", displayName: "Others" }
                ]
            }
        ]
    });
    const html = ruleView(rule).html;
    assert.ok(html.includes('data-default-context-key="others"'));
    assert.ok(html.includes('data-context-key="others" checked="checked">'));
    assert.ok(html.includes("<h4>How can I fix it in Spring&lt;</h4>"));
    assert.ok(html.includes(">Spring&lt;</label>"));
    assert.ok(html.includes("<h4></h4>"));
    assert.equal(contextHeading("How can I fix this?", { contextKey: "servlet", displayName: "Servlet" }), "How can I fix this in Servlet");
});

test("server description HTML passes through untouched (diff pairs, other-context-list)", () => {
    const content = loadFixture("rule-sections");
    const rule = baseRule({
        htmlDescriptionTabs: [{ title: "How to fix", hasContextualInformation: false, ruleDescriptionTabNonContextual: { htmlContent: content } }]
    });
    const html = ruleView(rule).html;
    assert.ok(html.includes(content));
    assert.ok(!html.includes("hljs-"));
    assert.ok(!html.includes("code-difference-scrollable"));
});

test("rule params: empty without params; table with escaped cells and current values", () => {
    assert.equal(renderRuleParams(baseRule()), "");
    assert.equal(renderRuleParams(baseRule({ parameters: [] })), "");
    const rule = baseRule({
        parameters: [
            { name: "max", description: "Maximum authorized number of parameters", defaultValue: "7" },
            { name: "format", description: "", defaultValue: "^[a-z]<x>$" }
        ]
    });
    const html = ruleView(rule, { paramValues: { max: 5 } }).html;
    assert.ok(html.includes('<table class="rule-params">\n  <caption>Parameters</caption>'));
    assert.ok(html.includes('<td colspan="2">'));
    assert.ok(html.includes("<th>max</th>"));
    assert.ok(html.includes("<p>Maximum authorized number of parameters</p>"));
    assert.ok(html.includes("<small>Current value: <code>5</code></small>"));
    assert.ok(html.includes("<small>(Default value: <code>7</code>)</small>"));
    assert.ok(html.includes("<small>(Default value: <code>^[a-z]&lt;x&gt;$</code>)</small>"));
    assert.equal(html.match(/Current value/g)?.length, 1);
});

test("sheet lists match upstream and resolve under the given extension path", () => {
    assert.deepEqual(VIEW_SHEETS.rule, ["theme.css", "rule.css", "hotspot.css", "vs.css", "terminal.css"]);
    assert.deepEqual(VIEW_SHEETS.hotspot, ["rule.css", "hotspot.css", "vs.css", "terminal.css"]);
    assert.deepEqual(VIEW_SHEETS.connection, ["theme.css"]);
    const paths = sheetPaths("rule", process.cwd(), ["extra.css"]);
    assert.deepEqual(paths.map((p) => path.basename(p)), [...VIEW_SHEETS.rule, "extra.css"]);
    assert.equal(paths[1], path.join(process.cwd(), "styles", "rule.css"));
    assert.ok(fs.readFileSync(paths[1], "utf8").includes(".rule-desc"));
    assert.deepEqual(sheetPaths("hotspot", "/ext").map((p) => p), ["/ext/styles/rule.css", "/ext/styles/hotspot.css", "/ext/styles/vs.css", "/ext/styles/terminal.css"]);
});
