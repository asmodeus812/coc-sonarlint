import { test } from "node:test";
import * as assert from "node:assert/strict";
import type { ExtendedClient, ShowRuleDescriptionParams } from "../../src/lsp/protocol";
import { loadFixture } from "../fixtures";
import { languageFromRuleKey, localHotspotView, probabilityName, remoteHotspotView, securityCategoryLabel } from "../../src/hotspot/hotspotView";

/** upstream test/suite/hotspots.test.ts:32-53 (`templateHotspot`, probability high = 0). */
function templateHotspot(): ExtendedClient.RemoteHotspot {
    return {
        message: "Hotspot here!",
        ideFilePath: "",
        key: "",
        textRange: { startLine: 1, endLine: 1 },
        author: "some.one@company.corp",
        status: "To Review",
        rule: {
            key: "java:S4242",
            name: "Life, The Universe and Everything",
            securityCategory: "dos",
            vulnerabilityProbability: 0,
            riskDescription: "Answering to this question might require building a huge planet-sized computer",
            vulnerabilityDescription: "If it is built on the path of a galactic highway, you might never get the answer",
            fixRecommendations: "Build it somewhere else"
        }
    } as ExtendedClient.RemoteHotspot;
}

test("remote hotspot: h1 and dl.hotspot-header key/value rows with upstream classes", () => {
    const view = remoteHotspotView(templateHotspot());
    assert.equal(view.view, "hotspot");
    assert.equal(view.title, "Hotspot here!");
    assert.ok(view.html.startsWith("<h1><big>Hotspot here!</big> (java:S4242)</h1>\n<dl class=\"hotspot-header\">"));
    assert.ok(view.html.includes("<dd>Category</dd><dt>Denial of Service (DoS)</dt>"));
    assert.ok(view.html.includes('<dd>Review priority</dd><dt><span class="hotspot-probability hotspot-probability-high">high</span></dt>'));
    assert.ok(view.html.includes("<dd>Author</dd><dt>some.one@company.corp</dt>"));
    assert.ok(view.html.includes("<dd>Status</dd><dt>To Review</dt>"));
});

test("remote hotspot: risk / assess / fix tabs carry the server HTML", () => {
    const hotspot = templateHotspot();
    hotspot.rule.riskDescription = loadFixture("rule-sections");
    const html = remoteHotspotView(hotspot).html;
    const labels = [...html.matchAll(/<label for="tab-(\d)" class="tabLabel">([^<]*)<\/label>/g)].map((m) => m[2]);
    assert.deepEqual(labels, ["What&#39;s the risk?", "Assess the risk", "How can I fix it?"]);
    assert.ok(html.includes('<main class="tabs">'));
    assert.ok(html.includes(`<div class="rule-desc">${hotspot.rule.riskDescription}</div>`));
    assert.ok(html.includes('<div class="rule-desc">Build it somewhere else</div>'));
    assert.ok(!html.includes("info-banner"), "the hotspot panel has no banner (upstream renders the description only)");
});

test("remote hotspot language: from the option, else from the rule key repository (upstream passed \"\")", () => {
    assert.equal(remoteHotspotView(templateHotspot()).lang, "java");
    assert.equal(remoteHotspotView(templateHotspot(), { languageKey: "kotlin" }).lang, "kotlin");
    assert.equal(languageFromRuleKey("python:S4790"), "py");
    assert.equal(languageFromRuleKey("javasecurity:S3649"), "java");
    assert.equal(languageFromRuleKey("csharpsquid:S2068"), "cs");
    assert.equal(languageFromRuleKey("Web:S5148"), "web");
    assert.equal(languageFromRuleKey("noRepository"), "");
});

test("remote hotspot escapes every header field", () => {
    const hotspot = templateHotspot();
    hotspot.message = "<img src=x onerror=1>";
    hotspot.author = `"bob"<b>`;
    hotspot.status = "&review";
    hotspot.rule.key = "java:<S1>";
    hotspot.rule.securityCategory = "__proto__";
    const html = remoteHotspotView(hotspot).html;
    assert.ok(html.includes("<big>&lt;img src=x onerror=1&gt;</big> (java:&lt;S1&gt;)"));
    assert.ok(html.includes("<dt>&quot;bob&quot;&lt;b&gt;</dt>"));
    assert.ok(html.includes("<dt>&amp;review</dt>"));
    assert.ok(html.includes("<dd>Category</dd><dt></dt>"));
    assert.ok(!html.includes("<img src"));
    assert.equal(securityCategoryLabel("weak-cryptography"), "Weak Cryptography");
});

test("probability names from enum indexes and names; unknown gives an empty name", () => {
    assert.deepEqual([0, 1, 2].map(probabilityName), ["high", "medium", "low"]);
    assert.equal(probabilityName("Medium"), "medium");
    assert.equal(probabilityName("LOW"), "low");
    assert.equal(probabilityName(7), "");
    assert.equal(probabilityName('x"'), "");
});

test("local hotspot keeps its rule's tabs, contexts and languageKey; no category or author", () => {
    const details: ShowRuleDescriptionParams = {
        key: "python:S4790",
        name: "Using weak hashing algorithms is security-sensitive",
        htmlDescription: "",
        htmlDescriptionTabs: [
            { title: "What's the risk?", hasContextualInformation: false, ruleDescriptionTabNonContextual: { htmlContent: "<p>risk</p>" } },
            {
                title: "How can I fix it?",
                hasContextualInformation: true,
                defaultContextKey: "django",
                ruleDescriptionTabContextual: [
                    { htmlContent: "<pre>a</pre>", contextKey: "flask", displayName: "Flask" },
                    { htmlContent: "<pre>b</pre>", contextKey: "django", displayName: "Django" }
                ]
            }
        ],
        severityDetails: { type: "SECURITY_HOTSPOT", severity: "" },
        languageKey: "py",
        isTaint: false
    };
    const view = localHotspotView(details, { message: "Make sure this is safe", probability: "High", status: "To review" });
    assert.equal(view.lang, "py");
    assert.ok(view.html.includes("<dd>Category</dd><dt></dt>"));
    assert.ok(view.html.includes("<dd>Author</dd><dt></dt>"));
    assert.ok(view.html.includes("hotspot-probability-high"));
    assert.ok(view.html.includes('<section class="tab contextualTabContainer" data-default-context-key="django">'));
    assert.ok(view.html.includes('data-context-key="django" checked="checked">'));
    assert.equal(localHotspotView({ ...details, languageKey: "" }, { message: "", probability: 1, status: "" }).lang, "py");
});
