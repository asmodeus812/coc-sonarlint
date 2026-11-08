/**
 * The SonarLint diff pre-pass: an {@link HtmlPrepass} run by the rule/hotspot adapters before the engine sees a
 * rule description. It produces exactly upstream's markup (upstream's `code-diff.ts`, from
 * `decorateContextualHtmlContentWithDiff`): every `pre[data-diff-id]` pair (`data-diff-type` noncompliant +
 * compliant, exactly two per id) becomes `<pre class="code-difference-scrollable"><div
 * class="code-difference-container">…</div></pre>`, its lines diffed (`diff.diffLines`) into
 * `<div>` (common), `<div class="code-diff code-removed">` (noncompliant side) and `<div class="code-diff
 * code-added">` (compliant side). Unpaired or incomplete pairs stay as written. The styling then comes from
 * upstream's rule.css through the cascade; the engine knows nothing about diffs.
 *
 * Lives here, not in the engine, because the markup is SonarLint's. Pure; never throws (returns the input unchanged
 * on failure).
 */
import { diffLines } from "diff";
import type { HtmlPrepass } from "../util/htmlviewApi";

/** Upstream's class names, as data (the oracle and the tests compare against them). */
export const DIFF_CLASSES = Object.freeze({
    pre: "code-difference-scrollable",
    container: "code-difference-container",
    diff: "code-diff",
    added: "code-added",
    removed: "code-removed",
});

const PRE_RE: RegExp = /<pre\b([^>]*)>([\s\S]*?)<\/pre\s*>/gi;

interface PreBlock {
    start: number;
    end: number;
    id: string;
    type: string;
    inner: string;
}

/** Value of attribute `name` in an attribute string, if present. */
function attrOf(attrs: string, name: string): string | undefined {
    const m: RegExpExecArray | null = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
    return m === null ? undefined : (m[1] ?? m[2] ?? m[3]);
}

/** Diffs the two sides line-wise into upstream's `<div>` markup: [noncompliant, compliant]. */
function differentiate(noncompliant: string, compliant: string): [string, string] {
    let nc: string = "";
    let c: string = "";
    for (const hunk of diffLines(noncompliant, compliant)) {
        if (hunk.added === true) {
            c += `<div class='${DIFF_CLASSES.diff} ${DIFF_CLASSES.added}'>${hunk.value}</div>`;
        } else if (hunk.removed === true) {
            nc += `<div class='${DIFF_CLASSES.diff} ${DIFF_CLASSES.removed}'>${hunk.value}</div>`;
        } else {
            nc += `<div>${hunk.value}</div>`;
            c += `<div>${hunk.value}</div>`;
        }
    }
    return [nc, c];
}

function wrap(code: string): string {
    return `<pre class="${DIFF_CLASSES.pre}"><div class="${DIFF_CLASSES.container}">${code}</div></pre>`;
}

function decorate(html: string): string {
    const blocks: PreBlock[] = [];
    PRE_RE.lastIndex = 0;
    for (let m: RegExpExecArray | null = PRE_RE.exec(html); m !== null; m = PRE_RE.exec(html)) {
        const id: string | undefined = attrOf(m[1], "data-diff-id");
        if (id !== undefined) {
            blocks.push({ start: m.index, end: m.index + m[0].length, id, type: attrOf(m[1], "data-diff-type") ?? "", inner: m[2] });
        }
    }
    const byId: Map<string, PreBlock[]> = new Map<string, PreBlock[]>();
    for (const b of blocks) {
        byId.set(b.id, [...(byId.get(b.id) ?? []), b]);
    }
    const replace: Map<PreBlock, string> = new Map<PreBlock, string>();
    byId.forEach((group: PreBlock[]): void => {
        // Exactly two blocks per id, one of each type (as upstream: other groups are left alone).
        const nc: PreBlock | undefined = group.find((b: PreBlock): boolean => b.type === "noncompliant");
        const c: PreBlock | undefined = group.find((b: PreBlock): boolean => b.type === "compliant");
        if (group.length === 2 && nc !== undefined && c !== undefined) {
            const [ncCode, cCode] = differentiate(nc.inner, c.inner);
            replace.set(nc, wrap(ncCode));
            replace.set(c, wrap(cCode));
        }
    });
    let out: string = "";
    let pos: number = 0;
    for (const b of blocks) {
        const r: string | undefined = replace.get(b);
        if (r !== undefined) {
            out += html.slice(pos, b.start) + r;
            pos = b.end;
        }
    }
    return out + html.slice(pos);
}

/** Adds upstream's code-diff markup to `html`. Never throws: the input comes back unchanged on failure. */
export const diffPrepass: HtmlPrepass = (html: string): string => {
    let result: string;
    try {
        result = decorate(html);
    } catch {
        result = html;
    }
    return result;
};
