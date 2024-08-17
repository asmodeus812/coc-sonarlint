/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2024 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict"

/**
 * Commonly used commands
 */
export namespace Commands {
    /**
     * Open Browser
     */
    export const OPEN_BROWSER = "vscode.open"

    /**
     * Open settings.json
     */
    export const OPEN_JSON_SETTINGS = "workbench.action.openSettingsJson"

    /**
     * Open settings
     */
    export const OPEN_SETTINGS = "workbench.action.openSettings"

    export const DEACTIVATE_RULE = "sonarlint.deactivate.rule"
    export const ACTIVATE_RULE = "sonarlint.activate.rule"
    export const TOGGLE_RULE = "sonarlint.toggle.rule"
    export const SHOW_ALL_RULES = "sonarlint.show.all.rules"
    export const SHOW_ACTIVE_RULES = "sonarlint.show.active.rules"
    export const SHOW_INACTIVE_RULES = "sonarlint.show.inactive.rules"
    export const SHOW_SONARLINT_OUTPUT = "sonarlint.show.sonar.lint.output"
    export const OPEN_RULE_BY_KEY = "sonarlint.open.rule.by.key"
    export const FIND_RULE_BY_KEY = "sonarlint.find.rule.by.key"
    export const SHOW_ALL_LOCATIONS = "sonarlint.show.all.locations"
    export const CLEAR_LOCATIONS = "sonarlint.clear.locations"
    export const NAVIGATE_TO_LOCATION = "sonarlint.navigate.to.location"

    export const INSTALL_MANAGED_JRE = "sonarlint.install.managed.jre"

    export const HIDE_HOTSPOT = "sonarlint.hide.hotspot"
    export const SHOW_HOTSPOT_DESCRIPTION = "sonarlint.show.hotspot.description"
    export const CONFIGURE_COMPILATION_DATABASE =
        "sonarlint.configure.compilation.database"

    export const CONNECT_TO_SONARQUBE = "sonarlint.connect.to.sonar.qube"
    export const CONNECT_TO_SONARCLOUD = "sonarlint.connect.to.sonar.cloud"
    export const EDIT_SONARQUBE_CONNECTION = "sonarlint.edit.sonar.qube.connection"
    export const EDIT_SONARCLOUD_CONNECTION =
        "sonarlint.edit.sonar.cloud.connection"
    export const SHARE_CONNECTED_MODE_CONFIG =
        "sonarlint.share.connected.mode.configuration"
    export const REMOVE_CONNECTION = "sonarlint.remove.connection"

    export const ADD_PROJECT_BINDING = "sonarlint.add.project.binding"
    export const EDIT_PROJECT_BINDING = "sonarlint.edit.project.binding"
    export const REMOVE_PROJECT_BINDING = "sonarlint.remove.project.binding"

    export const SHOW_HOTSPOT_LOCATION = "sonarlint.show.hotspot.location"
    export const SHOW_HOTSPOT_RULE_DESCRIPTION =
        "sonarlint.show.hotspot.rule.description"
    export const SHOW_HOTSPOT_DETAILS = "sonarlint.show.hotspot.details"
    export const OPEN_HOTSPOT_ON_SERVER = "sonarlint.open.hotspot.on.server"
    export const HIGHLIGHT_REMOTE_HOTSPOT_LOCATION =
        "sonarlint.highlight.remote.hotspot.location"
    export const CLEAR_HOTSPOT_HIGHLIGHTING = "sonarlint.clear.hotspot.locations"
    export const SHOW_HOTSPOTS_IN_OPEN_FILES =
        "sonarlint.show.hotspots.in.open.files"
    export const SCAN_FOR_HOTSPOTS_IN_FOLDER =
        "sonarlint.scan.for.hotspots.in.folder"
    export const FORGET_FOLDER_HOTSPOTS = "sonarlint.forget.folder.hotspots"

    export const RESOLVE_ISSUE = "sonarlint.resolve.issue"
    export const REOPEN_LOCAL_ISSUES = "sonarlint.reopen.local.issues"
    export const TRIGGER_HELP_AND_FEEDBACK_LINK =
        "sonarlint.help.and.feedback.link.clicked"
    export const CHANGE_HOTSPOT_STATUS = "sonarlint.change.hotspot.status"
    export const ENABLE_VERBOSE_LOGS = "sonarlint.enable.verbose.logs"
    export const ANALYSE_OPEN_FILE = "sonarlint.analyse.open.file"
    export const NEW_CODE_DEFINITION = "sonarlint.new.code.definition"
}
