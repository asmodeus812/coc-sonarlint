import assert from "node:assert/strict";
import { test } from "node:test";
import * as path from "path";
import { resolveSheetPath } from "../../src/util/viewSettings";

test("resolveSheetPath resolves relative paths against the root", () => {
    assert.equal(resolveSheetPath("a/b.css", "/ws"), path.resolve("/ws", "a/b.css"));
    assert.equal(resolveSheetPath("/abs/b.css", "/ws"), "/abs/b.css");
    assert.equal(resolveSheetPath("b.css", ""), "b.css");
});
