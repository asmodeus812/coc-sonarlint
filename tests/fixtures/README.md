# htmlview fixtures

Real-shaped HTML inputs for parse/layout tests. Upstream = `~/.projects/vscode-sonarlint` (paths relative to it).
Load them with `loadFixture(name)` / `listFixtures()` from `./index.ts` (tests run from the repo root).

## Extracted verbatim from upstream tests (string concatenations evaluated)

| File | Source | Covers |
|---|---|---|
| `code-diff-single-pair.html` | `test/suite/code-diff.test.ts:13` (`testHtmlString`) | `<pre data-diff-id data-diff-type>` pair split by `<h4>`, `&lt;/&gt;` in code, h3, `<br>` |
| `code-diff-three-pairs.html` | `test/suite/code-diff.test.ts:57` | three diff pairs plus one plain `<pre>` |
| `code-diff-no-pairs.html` | `test/suite/code-diff.test.ts:93` | plain `<pre>` only, no diff |
| `code-diff-decorated.html` | `test/suite/code-diff.test.ts:153` (`expectedResult`) | already-decorated markup (`pre.code-difference-scrollable`, `div.code-diff.code-added/removed`), what the old pipeline produced |
| `syntax-highlighted.html` | `test/suite/syntax-highlight.test.ts:41` (`expectedResult`) | `<span class="hljs-…">` inside `<pre>` (must flatten to text) |

## Rendered from upstream templates (template filled with the named test data)

| File | Template | Data | Covers |
|---|---|---|---|
| `rule-tabs-contexts.html` | `src/rules/rulepanel.ts:194-240` (`renderRuleDescription`, `computeTabContextualDescription`) | `test/suite/rulepanel.test.ts:37-66` (default context `jsp`) | `main.tabs`, radio inputs, `label.tabLabel`/`contextLabel`, `section.tab`, `contextualTabContainer` |
| `rule-params.html` | `src/rules/rulepanel.ts:258-290` (`renderRuleParams`) | two params (`max` with current value, `format` default only) | `table.rule-params`, caption, thead colspan, th/td, p, small, code |
| `rule-header-capsules.html` | `src/rules/rulepanel.ts:98-162` (`renderCleanCodeAttribute`, `renderImpact`, `renderStandardModeSeverityDetails`, `renderTaxonomyInfo`) | S1192, high/low impacts; svg icons omitted | h1 with `<big>`, `.taxonomy`, `.capsule`, `.impact-high`, `.severity-major`, `<img alt>`, `&nbsp;` |
| `hotspot.html` | `src/hotspot/hotspotContextPanel.ts:73-125` (+ `formatProbability` :19) | S4790 with risk/assess/fix tabs | full document (head dropped), `dl.hotspot-header` (labels in `dd`, values in `dt`), `hotspot-probability`, tabs |

## Hand-made in the server's rule-description format (no upstream sample exists for these)

| File | Covers |
|---|---|
| `rule-sections.html` | h2/h3/h4 sections, strong, links, inline code, nested ul > ul > ol (`start="3"`), diff pair, `ul.other-context-list` with `li.do`/`li.dont`, plain table, blockquote, hr |
| `edge-pre-in-li.html` | `<pre>` inside `<li>` (with a tab-indented line), `<pre><code>` in a nested list |
| `edge-mixed-li.html` | loose inline + `<p>` + inline + `<br>` + `<blockquote>` with bare inline in one `<li>`; empty `<li>`; `#anchor` link |
| `edge-entities.html` | `&rarr; &mdash; &lt; &amp; &hellip; &nbsp; &#8203; &#x2713;`; `&amp;#39;` must decode ONCE to the literal text `&#39;`; entities in `<pre>` |
| `edge-widths.html` | CJK/Hangul (2 cells), emoji (2 cells), combining accent (0 cells), wide chars in code |
| `edge-wide-table.html` | table wider than any window: long unbreakable cell content, colspan row |
| `demo.html` | the former `SonarLint.HtmlviewDemo` document: every rule-description component (capsules, banners, hotspot header, inline elements, tables, lists, code, tabs); has an oracle |
| `demo-rich.html` | the former `SonarLint.HtmlviewDemoRich` page: a generic, non-SonarLint page with its own embedded stylesheet and `<head>`; no oracle yet |

## Browser oracle (`oracle/`)

`oracle/<name>.json` (every fixture above plus `demo`): the computed styles headless Firefox gives each
element with Firefox's own UA sheet, VS Code's webview default styles and the view's upstream sheets (`styles/`),
body class `vscode-dark`; `oracle/vars.json` maps every `--vscode-*` variable to the sentinel colour it was given.
The engine's primary acceptance check (see `src/htmlview/CONTRACT.md`). Re-run after changing a fixture or a
sheet, from the repo root: `node scripts/oracle/capture.mjs [name ...]` (needs `firefox` on PATH; header of the script
has the details).
