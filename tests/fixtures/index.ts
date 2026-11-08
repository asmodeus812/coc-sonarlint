/**
 * Test-only fixture loader. Fixtures are the `.html` files of this folder (see README.md). Paths resolve from the
 * repo root (`npm test` runs there), because tests are bundled into a temp folder before running.
 */
import * as fs from "fs";
import * as path from "path";

/** Absolute path of the fixtures folder. */
export const fixturesDir: string = path.resolve(process.cwd(), "tests", "fixtures");

/** Fixture names (file names without `.html`), sorted. */
export function listFixtures(): string[] {
    return fs
        .readdirSync(fixturesDir)
        .filter((f) => f.endsWith(".html"))
        .map((f) => f.slice(0, -".html".length))
        .sort();
}

/** The HTML of fixture `name` (without `.html`). */
export function loadFixture(name: string): string {
    return fs.readFileSync(path.join(fixturesDir, name + ".html"), "utf8");
}
