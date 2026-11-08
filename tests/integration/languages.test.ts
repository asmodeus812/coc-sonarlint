import { test } from "node:test";
import * as assert from "node:assert/strict";
import hljs from "highlight.js";
import { buildLanguageTable, defaultLanguageTable } from "@htmlview/highlight";
import { resolveLanguage } from "@htmlview/highlight/languages";
import { SONAR_LANGUAGES } from "../../src/rules/languages";

const table = buildLanguageTable(defaultLanguageTable, SONAR_LANGUAGES);

test("rules/languages: SonarLint keys map onto generic names", () => {
    assert.deepEqual(resolveLanguage("web", table), resolveLanguage("html", defaultLanguageTable));
    assert.deepEqual(resolveLanguage("jsp", table), resolveLanguage("html", defaultLanguageTable));
    for (const key of ["cloudformation", "kubernetes", "ansible", "azurepipelines", "githubactions"]) {
        assert.deepEqual(resolveLanguage(key, table), resolveLanguage("yaml", defaultLanguageTable), key);
    }
    for (const key of ["plsql", "tsql"]) {
        assert.deepEqual(resolveLanguage(key, table), resolveLanguage("sql", defaultLanguageTable), key);
    }
    assert.deepEqual(resolveLanguage("ipynb", table), resolveLanguage("python", defaultLanguageTable));
    assert.deepEqual(resolveLanguage("flex", table), resolveLanguage("actionscript", defaultLanguageTable));
    assert.deepEqual(resolveLanguage("apex", table), resolveLanguage("java", defaultLanguageTable));
    assert.deepEqual(resolveLanguage("azureresourcemanager", table), resolveLanguage("bicep", defaultLanguageTable));
});

test("rules/languages: secrets and grammar-less languages are not highlighted", () => {
    for (const key of ["secrets", "text", "rpg", "abap", "jcl", "pli"]) {
        assert.deepEqual(resolveLanguage(key, table), {}, key);
    }
});

test("rules/languages: generic Sonar names resolve without the map and every alias target exists", () => {
    for (const key of ["java", "js", "ts", "py", "cs", "shell", "docker", "terraform", "vbnet", "objc", "kotlin", "go", "xml", "json"]) {
        assert.ok(resolveLanguage(key, defaultLanguageTable).treesitter !== undefined, key);
    }
    for (const [key, target] of Object.entries(SONAR_LANGUAGES)) {
        assert.ok(target === "" || Object.prototype.hasOwnProperty.call(defaultLanguageTable, target), `${key} -> ${target}`);
        const entry = resolveLanguage(key, table);
        assert.ok(entry.hljs === undefined || hljs.getLanguage(entry.hljs) !== undefined, key);
    }
});
