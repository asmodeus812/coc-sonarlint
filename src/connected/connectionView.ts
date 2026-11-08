/* --------------------------------------------------------------------------------------------
 * Connection details adapter: a connection tree item → htmlview input (a heading and a property table).
 * Upstream has no such panel; the markup is plain HTML styled by the theme sheet only.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import type { SonarCloudConnection, SonarQubeConnection } from "../settings/connectionsettings";
import { escapeHtml, ViewInput } from "../rules/markup";

/** What the view needs of a `Connection` tree item. */
export interface ConnectionDetails {
    status: string;
    connection: Partial<SonarQubeConnection & SonarCloudConnection>;
}

/** Options of {@link connectionView}. */
export interface ConnectionViewOptions {
    /** Heading and title; default `Connection Summary`. */
    title?: string;
}

/** The rows as `[label, html]`; the html cells are already escaped. */
export function connectionRows(details: ConnectionDetails): Array<[string, string]> {
    const conn: ConnectionDetails["connection"] = details.connection ?? {};
    const isServer: boolean = conn.serverUrl !== undefined;
    const location: Array<[string, string]> = isServer
        ? [["Server URL", textOrDash(conn.serverUrl)]]
        : [
              ["Organization Key", textOrDash(conn.organizationKey)],
              ["Region", textOrDash(conn.region ?? "EU")]
          ];
    const project: Array<[string, string]> = conn.projectKey ? [["Project Key", escapeHtml(conn.projectKey)]] : [];
    const folder: Array<[string, string]> = conn.folderUri
        ? [["Folder", `${escapeHtml(folderName(conn.folderUri))} (${escapeHtml(conn.folderUri)})`]]
        : [];
    return [
        ["Type", isServer ? "SonarQube" : "SonarQube Cloud"],
        ["Status", textOrDash(details.status)],
        ["Connection ID", textOrDash(conn.connectionId)],
        ...location,
        ["User Token", maskToken(conn.token)],
        ["Notifications", conn.disableNotifications ? "Off" : "On"],
        ...project,
        ...folder,
        ["Shared Configuration", conn.isFromSharedConfiguration ? "Yes" : "No"]
    ];
}

/** The connection details view: `h1`, `hr`, then a `table` of `th`/`td` rows under a `Properties` caption. */
export function connectionView(details: ConnectionDetails, options: ConnectionViewOptions = {}): ViewInput {
    const title: string = options.title ?? "Connection Summary";
    const rows: string = connectionRows(details)
        .map(([label, value]: [string, string]): string => `<tr><th>${escapeHtml(label)}</th><td>${value}</td></tr>`)
        .join("\n");
    const html: string = `<h1>${escapeHtml(title)}</h1>
<hr>
<table>
<caption>Properties</caption>
<tbody>
${rows}
</tbody>
</table>`;
    return { html, lang: "", view: "connection", title };
}

function textOrDash(value?: string | null): string {
    const text: string = (value ?? "").trim();
    return text ? escapeHtml(text) : "—";
}

/** `••••••••abcd (12 chars)`: never shows more than the last 4 characters. */
export function maskToken(token?: string): string {
    const text: string = token ?? "";
    const dots: string = "•".repeat(Math.max(4, Math.min(text.length - 4, 16)));
    return text ? `${dots}${escapeHtml(text.slice(-4))} (${text.length} chars)` : "—";
}

function folderName(uri: string): string {
    let pathname: string = uri;
    try {
        pathname = uri.startsWith("file://") ? decodeURIComponent(new URL(uri).pathname) : uri;
    } catch {
        pathname = uri;
    }
    const parts: string[] = pathname.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? "";
}
