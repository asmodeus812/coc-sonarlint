// The golden dump of the SonarLint views through the real htmlview render: runs dump.mjs (see there) into a temp folder
// and checks every input produced JSON; with GOLDEN_BASE set to an earlier dump it also requires the files to be equal.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

test("golden: dump of every fixture through htmlview matches the base (when given)", () => {
    const out: string = fs.mkdtempSync(path.join(os.tmpdir(), "sonar-golden-"));
    const result = spawnSync(process.execPath, [path.join(process.cwd(), "tests", "integration", "golden", "dump.mjs"), out], { cwd: process.cwd(), encoding: "utf8", timeout: 240000 });
    assert.equal(result.status, 0, result.stderr);
    const files: string[] = fs.readdirSync(out).filter((f: string) => f.endsWith(".json")).sort();
    assert.ok(files.length >= 17, `dumped ${files.length} inputs`);
    for (const f of files) {
        assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")), f);
    }
    const base: string | undefined = process.env.GOLDEN_BASE;
    if (base !== undefined && base !== "") {
        assert.deepEqual(fs.readdirSync(base).sort(), fs.readdirSync(out).sort());
        for (const f of files) {
            assert.equal(fs.readFileSync(path.join(out, f), "utf8"), fs.readFileSync(path.join(base, f), "utf8"), f);
        }
    }
    fs.rmSync(out, { recursive: true, force: true });
});
