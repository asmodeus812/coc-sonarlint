import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderSimple } from "../../../../src/views/backends/simple/render";

const has = (bin: string): boolean => spawnSync(bin, ["--version"], { timeout: 5000 }).status === 0;

/** Sets the rendered lines in a headless editor and applies every highlight at its byte columns. */
function smoke(bin: string): string {
    const dir = mkdtempSync(join(tmpdir(), "simple-smoke-"));
    const r = renderSimple(readFileSync(join(process.cwd(), "tests/fixtures/rule-tabs-contexts.html"), "utf8"), { width: 80 });
    writeFileSync(join(dir, "in.json"), JSON.stringify(r));
    writeFileSync(join(dir, "s.vim"), [
        "let r = json_decode(join(readfile($DIR . '/in.json'), ''))",
        "call setline(1, r.lines)",
        "let bad = filter(copy(r.highlights), {_, h -> h.colEnd > len(getline(h.lnum + 1)) || h.colStart > h.colEnd})",
        "for h in r.highlights | if h.colEnd > h.colStart | call matchaddpos(hlexists(h.hlGroup) ? h.hlGroup : 'Comment', [[h.lnum + 1, h.colStart + 1, h.colEnd - h.colStart]]) | endif | endfor",
        "call writefile([len(bad) == 0 && getline(1, '$') == r.lines ? 'ok' : 'bad ' . string(bad)], $DIR . '/out')",
        "qa!",
    ].join("\n"));
    spawnSync(bin, ["-N", "-u", "NONE", "-i", "NONE", "-es", "-S", join(dir, "s.vim")], { env: { ...process.env, DIR: dir }, timeout: 20000, stdio: "ignore" });
    return readFileSync(join(dir, "out"), "utf8").trim();
}

for (const bin of ["vim", "nvim"]) {
    test(`headless ${bin}: lines and highlight byte columns apply`, { skip: !has(bin) && `${bin} not found` }, () => {
        assert.equal(smoke(bin), "ok");
    });
}
