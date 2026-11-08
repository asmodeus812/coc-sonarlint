/* --------------------------------------------------------------------------------------------
 * Connection details view: a connection tree item → the reusable `sonarlint://connection` buffer.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { SonarViews } from "../util/views";
import { Connection } from "./connections";
import { ConnectionDetails, connectionView } from "./connectionView";

/** The SHOW_CONNECTION_INFO command handler. */
export function showConnectionDetails(views: SonarViews) {
    return async (connection: Connection): Promise<void> => {
        const details: ConnectionDetails["connection"] = connection.connection as ConnectionDetails["connection"];
        const input = connectionView({ status: connection.status, connection: details });
        const id: string = details?.connectionId ?? "";
        await views.show(input, { name: "sonarlint://connection", title: `Connection ${id}`.trim() });
    };
}
