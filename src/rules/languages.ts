/**
 * SonarLint language keys beyond the generic code-block names htmlview already knows (`java`, `js`, `ts`, `py`, `cs`,
 * `shell`, `docker`, `terraform`, `vbnet`, `objc`, …): an alias map passed to htmlview as `RenderOptions.languages`.
 * A string is an alias to a generic name; `""` means no highlighting (`secrets`, languages with no grammar).
 */
export const SONAR_LANGUAGES: Readonly<Record<string, string>> = Object.freeze({
    web: "html",
    jsp: "html",
    secrets: "",
    cloudformation: "yaml",
    kubernetes: "yaml",
    ansible: "yaml",
    azurepipelines: "yaml",
    githubactions: "yaml",
    azureresourcemanager: "bicep",
    plsql: "sql",
    tsql: "sql",
    ipynb: "python",
    flex: "actionscript",
    apex: "java",
    text: "",
    rpg: "",
    abap: "",
    jcl: "",
    pli: "",
});
