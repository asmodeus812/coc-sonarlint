/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

"use strict";

import * as fse from "fs";
import * as Path from "path";
import * as coc from "coc.nvim";
import { Uri } from "coc.nvim";
import { logToSonarLintOutput } from "../util/logging";
import { FileSystemService } from "./fileSystemService";
import { FileSystemSubscriber } from "./fileSystemSubscriber";

export class FileSystemServiceImpl implements FileSystemService {
    private readonly visited = new Set<string>();
    private static _instance: FileSystemServiceImpl;
    // .sonarlint folder is handled separately; We are not interested in other folders;
    private static readonly EXCLUDED_FOLDER_NAMES: string[] = [
        "node_modules",
        "target",
        ".sonarlint",
        ".settings",
        ".angular",
        ".next",
        ".nuxt",
        ".cargo",
        ".cache",
        ".github",
        ".tmp",
        ".log",
        ".vim",
        ".git",
        ".svn",
        ".hg",
        ".idea",
        ".vscode",
        "bower_components",
        "jspm_packages",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".tox",
        ".venv",
        ".env",
        ".npm",
        ".yarn",
        ".yarn-cache",
        ".yarnrc",
        ".lerna",
        ".serverless",
        ".terraform",
        ".vagrant",
        ".gradle",
        ".m2",
        ".ivy2",
        ".sass-cache",
        ".nyc_output",
        ".fusebox",
        ".rpt2_cache",
        ".rts2_cache",
        ".dynamodb"
    ];
    listeners: FileSystemSubscriber[] = [];

    static init(): void {
        FileSystemServiceImpl._instance = new FileSystemServiceImpl();
    }

    static get instance(): FileSystemServiceImpl {
        return FileSystemServiceImpl._instance;
    }

    subscribe(listener: FileSystemSubscriber) {
        this.listeners.push(listener);
    }

    public async crawlDirectory(uri: Uri) {
        await this.listFilesRecursively(uri, uri);
    }

    private async listFilesRecursively(configScopeUri: Uri, currentDirectory: Uri) {
        try {
            // Resolve and de-dupe the current dir by real path (handles symlinks)
            const realCurrent = fse.realpathSync.native(currentDirectory.fsPath);
            if (this.visited.has(realCurrent)) return;
            this.visited.add(realCurrent);

            // Read entries with their types to avoid extra stats
            const entries = fse.readdirSync(realCurrent, { withFileTypes: true });

            for (const entry of entries) {
                const name = entry.name;

                // Skip excluded folders fast (make this case-insensitive on Windows)
                if (entry.isDirectory()) {
                    const excluded =
                        process.platform === "win32"
                            ? FileSystemServiceImpl.EXCLUDED_FOLDER_NAMES.some((x) => x.toLowerCase() === name.toLowerCase())
                            : FileSystemServiceImpl.EXCLUDED_FOLDER_NAMES.includes(name);
                    if (excluded) continue;
                }

                const fullPath = Path.join(realCurrent, name);

                // Never follow symlinked directories (prevents cycles)
                if (entry.isSymbolicLink()) {
                    // Optionally: only allow symlinked files
                    const targetStat = fse.lstatSync(fullPath);
                    if (targetStat.isDirectory()) continue;
                }

                if (entry.isFile()) {
                    // Pass the *file* Uri correctly
                    this.listeners.forEach((listener) =>
                        listener.onFile(
                            currentDirectory.toString(), // or configScopeUri.toString() if that's intended
                            name,
                            coc.Uri.file(fullPath)
                        )
                    );
                } else if (entry.isDirectory()) {
                    // Recurse only into real directories, constructing the Uri safely
                    await this.listFilesRecursively(configScopeUri, coc.Uri.file(fullPath));
                }
                // Ignore other types (FIFO, socket, block/char device)
            }
        } catch (error) {
            logToSonarLintOutput(`Error encountered while listing files recursively: ${error}`);
        }
    }

    async didRemoveWorkspaceFolder(folder: coc.WorkspaceFolder) {
        for (const listener of this.listeners) {
            listener.didRemoveWorkspaceFolder(coc.Uri.parse(folder.uri));
        }
    }

    async didAddWorkspaceFolder(folder: coc.WorkspaceFolder) {
        this.crawlDirectory(coc.Uri.parse(folder.uri));
    }
}
