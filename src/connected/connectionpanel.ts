/* --------------------------------------------------------------------------------------------
 * Connection details view: a connection tree item → the reusable `sonarlint://connection` buffer.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { SonarViews } from "../views/sonarViews";
import { Connection } from "./connections";
import { ConnectionDetails, connectionView } from "./connectionView";

/** The SHOW_CONNECTION_INFO command handler. */
export function showConnectionDetails(views: SonarViews) {
    return async (connection: Connection): Promise<void> => {
        const details: ConnectionDetails["connection"] = connection.connection as ConnectionDetails["connection"];
        await views.show(connectionView({ status: connection.status, connection: details }));
    };
}
