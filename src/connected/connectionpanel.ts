import { FloatFactory, workspace } from "coc.nvim";
import { SonarCloudConnection, SonarQubeConnection } from "../settings/connectionsettings";
import { renderRuleHtmlWithCss } from "../util/htmlRenderer";
import { escapeHtml, showWebView } from "../util/webview";
import { Connection } from "./connections";

export function showConnectionDetails(factory: FloatFactory) {
    return async (connection: Connection) => {
        const text = renderConnectionSummaryHtml(connection);
        const result = await renderRuleHtmlWithCss(text);
        await showWebView(factory, result.text, result.highlights);
    };
}

function isSonarQubeConnection(c: SonarQubeConnection | SonarCloudConnection): c is SonarQubeConnection {
    return (c as SonarQubeConnection).serverUrl !== undefined;
}

export function renderConnectionSummaryHtml(c: Connection, opts?: { title?: string }): string {
    const conn: SonarQubeConnection | SonarCloudConnection = c.connection as any;
    const isSQ = isSonarQubeConnection(conn);
    const rows: Array<[string, string]> = [];

    rows.push(["Type", isSQ ? "SonarQube" : "SonarQube Cloud"]);
    rows.push(["Status", textOrDash(c.status)]);
    rows.push(["Connection ID", textOrDash(conn.connectionId)]);
    if (isSQ) {
        rows.push(["Server URL", textOrDash(conn.serverUrl)]);
    } else {
        rows.push(["Organization Key", textOrDash(conn.organizationKey)]);
        rows.push(["Region", textOrDash(conn.region ?? "EU")]);
    }
    rows.push(["User Token", maskToken(conn.token)]);
    rows.push(["Notifications", conn.disableNotifications ? badge("Off") : badge("On")]);
    if (conn.projectKey) rows.push(["Project Key", escapeHtml(conn.projectKey)]);
    if (conn.folderUri) {
        const name = extractFolderNameFromUri(conn.folderUri);
        rows.push(["Folder", `${escapeHtml(name)} <span class="muted">(${escapeHtml(conn.folderUri)})</span>`]);
    }
    rows.push(["Shared Configuration", conn.isFromSharedConfiguration ? "Yes" : "No"]);

    const tableRows = rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join("");

    const title = escapeHtml(opts?.title ?? "Connection Summary");

    // Inline, portable HTML (no JS, no external CSS)
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
</head>
<body>
  <h1>${title}</h1>
    ${unicodeSeparatorHtml("─", 60)}
  <table>
    <caption>Properties</caption>
    ${tableRows}
  </table>
</body>
</html>`;
}

function textOrDash(v?: string | null): string {
    const s = (v ?? "").trim();
    return s ? escapeHtml(s) : "—";
}

function badge(text: string): string {
    return `<span class="badge">${escapeHtml(text)}</span>`;
}

function maskToken(token?: string): string {
    const t = token ?? "";
    if (!t) return "—";
    const last4 = t.slice(-4);
    const dots = "•".repeat(Math.max(4, Math.min(t.length - 4, 16)));
    return `${dots}${escapeHtml(last4)} <span class="muted">(${t.length} chars)</span>`;
}

function extractFolderNameFromUri(uri: string): string {
    try {
        if (uri.startsWith("file://")) {
            const u = new URL(uri);
            const parts = u.pathname.split("/").filter(Boolean);
            return decodeURIComponent(parts[parts.length - 1] ?? "");
        }
    } catch {}
    const parts = uri.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? "";
}

function unicodeSeparatorHtml(char = "─", count?: number): string {
    return `<pre class="uni-sep" role="separator" aria-hidden="true">${char.repeat(count || workspace.env.columns)}</pre>`;
}
