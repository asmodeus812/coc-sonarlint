/* --------------------------------------------------------------------------------------------
 * Sonarlint
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { FindingsFileNode } from "./findingsFileNode";

export class FindingsFolderNode extends FindingsFileNode {
    constructor(
        public readonly fileUri: string,
        public readonly findingsCount: number,
        public readonly category?: "new" | "older"
    ) {
        super(fileUri, findingsCount, category);
    }
}
