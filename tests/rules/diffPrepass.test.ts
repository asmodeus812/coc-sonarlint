import { test } from "node:test";
import * as assert from "node:assert/strict";
import { DIFF_CLASSES, diffPrepass } from "../../src/rules/diffPrepass";
import { loadFixture } from "../fixtures";

const SESSION =
    '<pre data-diff-id="1" data-diff-type="noncompliant">\naaa\nbbb\nddd\n</pre>\n' +
    '<h4>Compliant solution</h4>\n' +
    '<pre data-diff-id="1" data-diff-type="compliant">\naaa\nbbb\nccc</pre>\n<p>Session .<br> Often</p>';

test("diffPrepass: matches upstream's decorateContextualHtmlContentWithDiff output exactly", () => {
    const expected =
        '<pre class="code-difference-scrollable"><div class="code-difference-container"><div>\naaa\nbbb\n</div>' +
        "<div class='code-diff code-removed'>ddd\n</div></div></pre>\n" +
        '<h4>Compliant solution</h4>\n' +
        '<pre class="code-difference-scrollable"><div class="code-difference-container"><div>\naaa\nbbb\n</div>' +
        "<div class='code-diff code-added'>ccc</div></div></pre>\n<p>Session .<br> Often</p>";
    assert.equal(diffPrepass(SESSION), expected);
});

test("diffPrepass: identical sides produce one common div each, no diff classes", () => {
    const html = '<pre data-diff-id="a" data-diff-type="noncompliant">x\ny\n</pre><pre data-diff-id="a" data-diff-type="compliant">x\ny\n</pre>';
    const out = diffPrepass(html);
    assert.ok(out.includes('<div class="code-difference-container"><div>x\ny\n</div></div>'));
    assert.ok(!out.includes(`class='${DIFF_CLASSES.diff} `));
});

test("diffPrepass: single-pair fixture gets removed and added lines on the right sides", () => {
    const out = diffPrepass(loadFixture("code-diff-single-pair"));
    assert.equal(out.split(DIFF_CLASSES.pre).length - 1, 2);
    assert.ok(!out.includes("data-diff-id"));
    const [nc, c] = out.split("<h4>Compliant solution</h4>");
    assert.ok(nc.includes("code-diff code-removed") && !nc.includes("code-added"));
    assert.ok(c.includes("code-diff code-added") && !c.includes("code-removed"));
    assert.ok(nc.includes("String cookie = request.getParameter"));
    assert.ok(c.includes('sendRedirect("/getCookie.jsp")'));
});

test("diffPrepass: three-pairs fixture decorates six pres; the plain pre stays", () => {
    const out = diffPrepass(loadFixture("code-diff-three-pairs"));
    assert.equal(out.split(`<pre class="${DIFF_CLASSES.pre}">`).length - 1, 6);
    assert.ok(out.includes("<pre>\n  void doGet"));
});

test("diffPrepass: unpaired, mistyped and tripled pres are left alone", () => {
    const none = loadFixture("code-diff-no-pairs");
    assert.equal(diffPrepass(none), none);
    const lone = '<pre data-diff-id="1" data-diff-type="noncompliant">a</pre>';
    assert.equal(diffPrepass(lone), lone);
    const twice = '<pre data-diff-id="1" data-diff-type="compliant">a</pre><pre data-diff-id="1" data-diff-type="compliant">b</pre>';
    assert.equal(diffPrepass(twice), twice);
    const three = lone + lone + '<pre data-diff-id="1" data-diff-type="compliant">b</pre>';
    assert.equal(diffPrepass(three), three);
});

test("diffPrepass: already-decorated input and odd input never throw", () => {
    const done = loadFixture("code-diff-decorated");
    assert.equal(diffPrepass(done), done);
    for (const s of ["", "<pre", "<pre data-diff-id=>", "</pre><pre data-diff-id='1'", "\u0000<<>>"]) {
        assert.doesNotThrow(() => diffPrepass(s));
    }
});
