/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as coc from "coc.nvim";

import { DEFAULT_CONNECTION_ID } from "../commons";
import { ConnectionCheckResult, ExtendedServer } from "../lsp/protocol";
import {
    ConnectionSettingsService,
    isSonarQubeConnection,
    SonarCloudConnection,
    SonarCloudRegion,
    SonarQubeConnection
} from "../settings/connectionsettings";
import { shouldShowRegionSelection } from "../settings/settings";
import { Commands } from "../util/commands";
import { renderRuleHtmlWithCss } from "../util/htmlRenderer";
import { escapeHtml, showWebView } from "../util/webview";
import { BindingService } from "./binding";
import { Connection } from "./connections";

const sonarQubeNotificationsDocUrl = "https://docs.sonarsource.com/sonarqube-server/user-guide/connected-mode/";
const sonarCloudNotificationsDocUrl = "https://docs.sonarsource.com/sonarqube-cloud/improving/connected-mode/#smart-notifications";
const TOKEN_RECEIVED_COMMAND = "tokenReceived";
const OPEN_TOKEN_GENERATION_PAGE_COMMAND = "openTokenGenerationPage";
const SAVE_CONNECTION_COMMAND = "saveConnection";
const ORGANIZATION_LIST_RECEIVED_COMMAND = "organizationListReceived";

const SONARQUBE_DESCRIPTION = `A <b>self-managed</b> tool that easily integrates into the developers' CI/CD pipeline<br>
  and DevOps platform to systematically help you deliver high-quality, secure code.
  <br><br>
  Discover which offer is better for your team <a id="sonarQubeEditionsDownloads" href="#">here</a>.`;

const SONARCLOUD_DESCRIPTION = `A <b>Software-as-a-Service (SaaS)</b> tool that easily integrates into the cloud DevOps platforms<br>
  and extends the CI/CD workflow to systematically help you deliver high-quality, secure code.
  <br><br>
  Explore SonarQube Cloud with our <a id="sonarqubeCloudFreeSignUp" href="#">free tier</a>.`;

const SONARQUBE_SERVER_LABEL = "SonarQube Server";
const SONARQUBE_CLOUD_LABEL = "SonarQube Cloud";

export function connectToSonarQube(context: coc.ExtensionContext, factory: coc.FloatFactory) {
    return async (serverUrl = "", projectKey = "", isFromSharedConfiguration = false, folderUri?: coc.Uri) => {
        const initialState = {
            conn: {
                serverUrl,
                token: "",
                connectionId: "",
                projectKey,
                isFromSharedConfiguration,
                folderUri: folderUri?.toString(false)
            }
        };
        await initializeAndShow(context, { mode: "create", initialState }, SONARQUBE_SERVER_LABEL, factory);
    };
}

export function connectToSonarCloud(context: coc.ExtensionContext, factory: coc.FloatFactory) {
    return async (
        organizationKey = "",
        projectKey = "",
        isFromSharedConfiguration = false,
        region: SonarCloudRegion = "EU",
        folderUri?: coc.Uri
    ) => {
        const initialState = {
            conn: {
                organizationKey,
                token: "",
                connectionId: "",
                projectKey,
                isFromSharedConfiguration,
                folderUri: folderUri?.toString(false),
                region
            }
        };
        await initializeAndShow(context, { mode: "create", initialState }, SONARQUBE_CLOUD_LABEL, factory);
    };
}

export function editSonarQubeConnection(_context: coc.ExtensionContext, factory: coc.FloatFactory) {
    return async (connection: string | Promise<Connection>) => {
        const connectionId = typeof connection === "string" ? connection : (await connection).id;
        const initialState = {
            conn: await ConnectionSettingsService.instance.loadSonarQubeConnection(connectionId)
        } as WebviewInitialState;
        await initializeAndShow(_context, { mode: "update", initialState }, SONARQUBE_SERVER_LABEL, factory);
    };
}

export function editSonarCloudConnection(_context: coc.ExtensionContext, factory: coc.FloatFactory) {
    return async (connection: string | Promise<Connection>) => {
        const connectionId = typeof connection === "string" ? connection : (await connection).id;
        const existingConnection = await ConnectionSettingsService.instance.loadSonarCloudConnection(connectionId);
        const initialState = {
            conn: existingConnection,
            userOrganizations: await ConnectionSettingsService.instance.listUserOrganizations(
                existingConnection?.token as string,
                existingConnection?.region as string
            )
        } as WebviewInitialState;
        await initializeAndShow(_context, { mode: "update", initialState }, SONARQUBE_CLOUD_LABEL, factory);
    };
}

// ★ new: simple “show” (no panel), just build HTML and hand to showWebView
async function initializeAndShow(
    context: coc.ExtensionContext,
    renderOptions: RenderOptions,
    serverProductName: string,
    factory: coc.FloatFactory
) {
    const text = renderConnectionSetupHtml(renderOptions);
    const result = await renderRuleHtmlWithCss(text);
    await showWebView(factory, result.text, result.highlights);
}

export async function reportConnectionCheckResult(result: ConnectionCheckResult) {
    if (result.success) {
        // previous behavior: if panel open, close and toast
        coc.window.showInformationMessage(`Connection with '${result.connectionId}' was successful!`);
        // ★ no panel to dispose
    } else {
        const editConnectionAction = "Edit Connection";
        const reply = await coc.window.showErrorMessage(
            `Connection with '${result.connectionId}' failed. Please check your settings.`,
            editConnectionAction
        );
        if (reply === editConnectionAction) {
            coc.commands.executeCommand(Commands.EDIT_SONARQUBE_CONNECTION, result.connectionId);
        }
    }
}

export async function handleInvalidTokenNotification(connectionId: string) {
    const isSonarQube =
        ConnectionSettingsService.instance.getSonarQubeConnections()?.findIndex((c) => c.connectionId === connectionId) !== -1;
    const isSonarCloud =
        ConnectionSettingsService.instance.getSonarCloudConnections()?.findIndex((c) => c.connectionId === connectionId) !== -1;
    if (!isSonarCloud && !isSonarQube) {
        return;
    }

    const editConnectionAction = "Edit Connection";
    const reply = await coc.window.showErrorMessage(
        `Connection to '${connectionId}' failed: Please verify your token.`,
        editConnectionAction
    );
    if (reply === editConnectionAction) {
        if (isSonarQube) {
            coc.commands.executeCommand(Commands.EDIT_SONARQUBE_CONNECTION, connectionId);
        } else if (isSonarCloud) {
            coc.commands.executeCommand(Commands.EDIT_SONARCLOUD_CONNECTION, connectionId);
        }
        coc.commands.executeCommand("SonarLint.ConnectedMode.focus");
    }
}

interface RenderOptions {
    mode: "create" | "update";
    initialState: WebviewInitialState;
}

interface WebviewInitialState {
    conn: SonarQubeConnection | SonarCloudConnection;
    userOrganizations?: ExtendedServer.Organization[];
}

// ★ simplified: no coc.Webview/ResourceResolver/CSP/toolkit — just HTML your showWebView can render.
function renderConnectionSetupHtml(options: RenderOptions) {
    const { mode, initialState } = options;
    const connection = initialState.conn;
    const isSQ = isSonarQubeConnection(connection);

    const serverProductName = isSQ ? SONARQUBE_SERVER_LABEL : SONARQUBE_CLOUD_LABEL;
    const serverDocUrl = isSQ ? sonarQubeNotificationsDocUrl : sonarCloudNotificationsDocUrl;

    const initialConnectionId = escapeHtml(connection.connectionId as string) || "";
    const initialToken = escapeHtml(connection.token as string);
    const maybeProjectKey = (connection as any).projectKey;
    const saveButtonLabel = maybeProjectKey ? "Save Connection And Bind Project" : "Save Connection";

    const isFromSharedConfiguration = (connection as any).isFromSharedConfiguration;
    const maybeFolderUri = (connection as any).folderUri || "";
    const maybeFolderBindingParagraph = renderBindingParagraph(maybeFolderUri, maybeProjectKey);

    return `<!doctype html><html lang="en">
  <head>
    <meta charset="utf-8"/>
    <title>${serverProductName} Connection</title>
    <style>
      body { font: 14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; padding:16px; }
      h1 { margin: 0 0 8px; font-size: 18px; }
      hr { margin: 12px 0; }
      .formRowWithStatus { display:flex; align-items:center; gap:8px; margin:8px 0; }
      input[type="text"], input[type="url"], input[type="password"] { padding:6px 8px; width: 420px; }
      label { display:block; margin:8px 0 4px; font-weight:600; }
      .warning { color:#b45309; margin-left:6px; }
      .hidden { display:none; }
      .btn { padding:6px 10px; border:1px solid #ddd; background:#f7f7f7; border-radius:6px; cursor:pointer; }
      .btn[disabled] { opacity:.6; cursor:not-allowed; }
      .checkbox { display:flex; gap:8px; align-items:flex-start; margin:10px 0; }
      small.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
      .dropdown-container { display:flex; gap:8px; align-items:center; }
    </style>
  </head>
  <body>
    <h1>${mode === "create" ? "New" : "Edit"} ${serverProductName} Connection</h1>
    <hr>
    <div>${isSQ ? SONARQUBE_DESCRIPTION : SONARCLOUD_DESCRIPTION}</div>
    <hr>
    <form id="connectionForm">
      ${renderServerUrlFieldLite(initialState, mode)}
      ${renderGenerateTokenButtonLite(connection, serverProductName)}
      <div class="formRowWithStatus">
        <label for="token">User Token</label>
      </div>
      <div class="formRowWithStatus">
        <input id="token" type="password" placeholder="········" title="A user token generated for your account on ${serverProductName}" value="${initialToken}" required/>
        <span id="tokenStatus" class="hidden">Token received!</span>
        <input type="hidden" id="token-initial" value="${initialToken}" />
      </div>

      ${renderOrganizationKeyFieldLite(initialState)}

      <label for="connectionId">Connection Name</label>
      <input id="connectionId" type="text" placeholder="My ${serverProductName} Connection"
        title="Optionally, please give this connection a memorable name. If no name is provided, Sonar will generate one."
        value="${initialConnectionId}" ${options.mode === "update" ? "readonly" : ""} />
      <input type="hidden" id="connectionId-initial" value="${initialConnectionId}" />
      <input type="hidden" id="shouldGenerateConnectionId" value="${mode === "create"}" />
      <input type="hidden" id="projectKey" value="${maybeProjectKey || ""}" />
      <input type="hidden" id="isFromSharedConfiguration" value="${isFromSharedConfiguration}" />
      <input type="hidden" id="folderUri" value="${maybeFolderUri}" />

      <div class="checkbox">
        <input id="enableNotifications" type="checkbox" ${!(connection as any).disableNotifications ? "checked" : ""}/>
        <label for="enableNotifications">
          Receive <a target="_blank" href="${serverDocUrl}">notifications</a> from ${serverProductName}
          for the Quality Gate status and new issues assigned to you
        </label>
      </div>
      <input type="hidden" id="enableNotifications-initial" value="${!(connection as any).disableNotifications}" />

      ${maybeFolderBindingParagraph}

      <p>
        <a href='https://docs.sonarsource.com/sonarqube-for-vs-code/team-features/connected-mode-setup/#connection-setup'>
          Need help setting up a connection?
        </a>
      </p>

      <div id="connectionCheck" class="formRowWithStatus">
        <button id="saveConnection" class="btn" disabled>${saveButtonLabel}</button>
        <span id="connectionProgress" class="hidden">Working…</span>
        <span id="connectionStatus"></span>
      </div>
    </form>

    <!-- Optional: if your showWebView injects a bridge, wire events using it -->
    <script>
      const $ = (s) => document.querySelector(s);
      const isSQ = ${isSQ ? "true" : "false"};

      const saveBtn = $('#saveConnection');
      const tokenEl = $('#token');
      const serverUrlEl = $('#serverUrl');
      const orgSelectEl = $('#organizationKey');
      const manualOrgEl = $('#manualOrganizationKey');

      function canEnableSave() {
        if (isSQ) return tokenEl.value && serverUrlEl.value;
        return tokenEl.value && (orgSelectEl?.value || manualOrgEl?.value);
      }
      function updateSaveState() { saveBtn.disabled = !canEnableSave(); }
      document.addEventListener('input', updateSaveState);
      document.addEventListener('change', updateSaveState);
      updateSaveState();

      // Simple UX for org dropdown toggle
      if (orgSelectEl) {
        orgSelectEl.addEventListener('change', () => {
          if (orgSelectEl.value === 'organizationKeyManualInput') {
            manualOrgEl.hidden = false; manualOrgEl.required = true;
          } else {
            if (manualOrgEl) { manualOrgEl.hidden = true; manualOrgEl.required = false; }
          }
        });
      }

      // Buttons → extension messages (if your host wires window.__cocPostMessage)
      function post(msg) { (window.__cocPostMessage || (m=>{}))(msg); }

      const genBtn = document.getElementById('generateToken');
      if (genBtn) genBtn.addEventListener('click', (e) => {
        e.preventDefault();
        post({
          command: '${OPEN_TOKEN_GENERATION_PAGE_COMMAND}',
          serverUrl: serverUrlEl?.value || '',
          region: document.getElementById('region')?.value || 'EU',
          preFilledOrganizationKey: orgSelectEl?.value || manualOrgEl?.value || ''
        });
      });

      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const payload = {
          command: '${SAVE_CONNECTION_COMMAND}',
          token: tokenEl.value,
          connectionId: document.getElementById('connectionId').value,
          disableNotifications: !document.getElementById('enableNotifications').checked,
          shouldGenerateConnectionId: document.getElementById('shouldGenerateConnectionId').value === 'true',
          isFromSharedConfiguration: document.getElementById('isFromSharedConfiguration').value === 'true',
          folderUri: document.getElementById('folderUri').value,
        };
        if (isSQ) {
          payload.serverUrl = serverUrlEl.value;
          payload.projectKey = document.getElementById('projectKey').value;
        } else {
          const sel = orgSelectEl?.value;
          payload.organizationKey = sel === 'organizationKeyManualInput' ? manualOrgEl.value : sel;
          payload.region = document.getElementById('region')?.value || 'EU';
          payload.projectKey = document.getElementById('projectKey').value;
        }
        post(payload);
      });

      // Optional incoming messages (extension → webview)
      window.__cocOnMessage = function(msg) {
        if (msg?.command === 'tokenGenerationPageIsOpen') {
          const s = document.getElementById('tokenGenerationResult');
          s.textContent = msg.errorMessage || 'Follow the instructions in your browser…';
        }
        if (msg?.command === 'connectionCheckStart') {
          document.getElementById('connectionProgress')?.classList.remove('hidden');
        }
        if (msg?.command === 'connectionCheckFailure') {
          document.getElementById('connectionProgress')?.classList.add('hidden');
          const st = document.getElementById('connectionStatus'); st.textContent = msg.message || 'Failed';
        }
        if (msg?.command === '${TOKEN_RECEIVED_COMMAND}') {
          document.getElementById('token').value = msg.token || '';
          document.getElementById('tokenStatus')?.classList.remove('hidden');
          document.getElementById('tokenGenerationResult').textContent = 'Token received';
          ${!isSQ ? "document.getElementById('region')?.dispatchEvent(new Event('change'));" : ""}
        }
        if (msg?.command === '${ORGANIZATION_LIST_RECEIVED_COMMAND}') {
          const dd = document.getElementById('organizationKey');
          if (dd && Array.isArray(msg.organizations)) {
            const sel = dd.value;
            dd.innerHTML = '';
            for (const o of msg.organizations) {
              const opt = document.createElement('option');
              opt.value = o.key; opt.textContent = o.name;
              if (o.key === sel) opt.selected = true;
              dd.appendChild(opt);
            }
            const other = document.createElement('option');
            other.value = 'organizationKeyManualInput'; other.textContent = 'Other... (provide organization key)';
            dd.appendChild(other);
          }
        }
      };
    </script>
  </body>
</html>`;
}

function renderServerUrlFieldLite(initialState: WebviewInitialState, mode: "create" | "update") {
    if (isSonarQubeConnection(initialState.conn)) {
        const serverUrl = escapeHtml(initialState.conn.serverUrl);
        return `
      <label for="serverUrl"><b>Server URL</b></label>
      <input id="serverUrl" type="url" placeholder="https://your.sonarqube.server/" value="${serverUrl}" required autofocus />
      <span class='warning'>${serverUrl && mode !== "update" ? "Please ensure that your Server URL matches your SonarQube Server instance." : ""}</span>
      <input type="hidden" id="serverUrl-initial" value="${serverUrl}" />
    `;
    }
    // SonarCloud region
    const hidden = !shouldShowRegionSelection();
    const region = initialState.conn.region ?? "EU";
    const euChecked = region === "EU" ? "checked" : "";
    const usChecked = region === "US" ? "checked" : "";
    return `
    <fieldset ${hidden ? "style='display:none'" : ""}>
      <legend>Select the SonarQube Cloud region you would like to connect to</legend>
      <label><input type="radio" name="region" id="region" value="EU" ${euChecked}/> <b>EU</b> - sonarcloud.io</label><br/>
      <label><input type="radio" name="region" value="US" ${usChecked}/> <b>US</b> - sonarqube.us</label>
    </fieldset>`;
}

function renderGenerateTokenButtonLite(connection: SonarQubeConnection | SonarCloudConnection, serverProductName: string) {
    const buttonDisabled = isSonarQubeConnection(connection) && connection.serverUrl === "" ? "disabled" : "";
    return `
    <div class="formRowWithStatus">
      <button id="generateToken" class="btn" ${buttonDisabled}>Generate Token</button>
      <span id="tokenGenerationProgress" class="hidden">Opening…</span>
      <span id="tokenGenerationResult"></span>
    </div>`;
}

function renderOrganizationKeyFieldLite(initialState: WebviewInitialState) {
    if (isSonarQubeConnection(initialState.conn)) return "";
    const organizationKey = escapeHtml(initialState.conn.organizationKey || "");
    let options = "";
    if (organizationKey) options += `<option selected>${organizationKey}</option>`;
    if (initialState.userOrganizations && initialState.userOrganizations.length > 0) {
        for (const o of initialState.userOrganizations) {
            if (organizationKey !== o.key) options += `<option value="${o.key}">${o.name}</option>`;
        }
        options += `<option value="organizationKeyManualInput">Other... (provide organization key)</option>`;
    }
    return `
    <label for="organizationKey">Organization</label>
    <div class="dropdown-container">
      <select id="organizationKey" required>${options}</select>
      <input id="manualOrganizationKey" type="text" placeholder="Enter organization key" value="${organizationKey}" hidden/>
    </div>
    <input type="hidden" id="organizationKey-initial" value="${organizationKey}" />`;
}

function renderBindingParagraph(maybeFolderUri: string, maybeProjectKey: string) {
    if (maybeFolderUri) {
        const folderUri = coc.Uri.parse(maybeFolderUri);
        const workspaceFolder = coc.workspace.getWorkspaceFolder(folderUri);
        return `<br>Once the connection is saved, workspace folder '${escapeHtml(workspaceFolder?.name as string)}' will be bound to project '${escapeHtml(
            maybeProjectKey || ""
        )}'.<br>`;
    }
    return "";
}

/* ---------------- messages from page → extension (unchanged API) ---------------- */

export async function handleMessage(message: any) {
    await handleMessageWithConnectionSettingsService(message, ConnectionSettingsService.instance);
}

const TOKEN_CHANGED_COMMAND = "tokenChanged";

export async function handleMessageWithConnectionSettingsService(message: any, connectionSettingsService: ConnectionSettingsService) {
    switch (message.command) {
        case OPEN_TOKEN_GENERATION_PAGE_COMMAND:
            await openTokenGenerationPage(message);
            break;
        case SAVE_CONNECTION_COMMAND:
            delete message.command;
            if (!message.disableNotifications) {
                delete message.disableNotifications;
            }
            if (!message.connectionId) {
                message.connectionId = getDefaultConnectionId(message);
            }
            if (message.serverUrl) {
                message.serverUrl = cleanServerUrl(message.serverUrl);
            }
            await saveConnection(message, connectionSettingsService);
            break;
        case TOKEN_CHANGED_COMMAND:
            delete message.command;
            break;
    }
}

export function getDefaultConnectionId(message: any): string {
    let defaultConnectionId = DEFAULT_CONNECTION_ID;
    if (message.serverUrl) {
        defaultConnectionId = cleanServerUrl(message.serverUrl);
    }
    if (message.organizationKey) {
        defaultConnectionId = message.organizationKey;
    }
    return defaultConnectionId;
}

async function openTokenGenerationPage(message: any) {
    const { serverUrl } = message;
    const cleanedUrl = cleanServerUrl(serverUrl || "");
    ConnectionSettingsService.instance.generateToken(cleanedUrl).catch(async (_error) => {
        coc.window.showErrorMessage(_error);
    });
}

async function saveConnection(
    connection: SonarQubeConnection | SonarCloudConnection,
    connectionSettingsService: ConnectionSettingsService
) {
    const isSQConnection = isSonarQubeConnection(connection);
    const serverOrOrganization = isSQConnection
        ? (connection).serverUrl
        : (connection).organizationKey;
    const region = isSQConnection ? null : (connection).region;

    const connectionCheckResult = await connectionSettingsService.checkNewConnection(
        connection.token as string,
        serverOrOrganization,
        isSQConnection,
        region as any
    );
    await reportConnectionCheckResult(connectionCheckResult);
    if (!connectionCheckResult.success) return;

    if (isSQConnection) {
        await saveSonarQubeServerConnection(connection, connectionSettingsService);
    } else {
        await saveSonarQubeCloudConnection(connection, connectionSettingsService);
    }

    if ((connection as any).projectKey && (connection as any).folderUri) {
        const folderUri = coc.Uri.parse((connection as any).folderUri);
        const workspaceFolder = coc.workspace.getWorkspaceFolder(folderUri);
        const bindingCreationMode = (connection as any).isFromSharedConfiguration
            ? ExtendedServer.BindingCreationMode.IMPORTED
            : ExtendedServer.BindingCreationMode.AUTOMATIC;
        await BindingService.instance.saveBinding(
            (connection as any).projectKey,
            workspaceFolder as coc.WorkspaceFolder,
            bindingCreationMode,
            (connection as any).connectionId
        );
    }

    coc.commands.executeCommand(
        Commands.FOCUS_ON_CONNECTION,
        isSQConnection ? "__sonarqube__" : "__sonarcloud__",
        (connection as any).connectionId
    );
}

async function saveSonarQubeServerConnection(connection: SonarQubeConnection, connectionSettingsService: ConnectionSettingsService) {
    const foundConnection = await connectionSettingsService.loadSonarQubeConnection(connection.connectionId as string);
    if (foundConnection) {
        await connectionSettingsService.updateSonarQubeConnection(connection);
    } else {
        await connectionSettingsService.addSonarQubeConnection(connection);
    }
}

async function saveSonarQubeCloudConnection(connection: SonarCloudConnection, connectionSettingsService: ConnectionSettingsService) {
    const foundConnection = await connectionSettingsService.loadSonarCloudConnection(connection.connectionId as string);
    if (foundConnection) {
        await connectionSettingsService.updateSonarCloudConnection(connection);
    } else {
        await connectionSettingsService.addSonarCloudConnection(connection);
    }
}

function cleanServerUrl(serverUrl: string) {
    return removeTrailingSlashes((serverUrl || "").trim());
}
function removeTrailingSlashes(url: string) {
    let cleanedUrl = url;
    while (cleanedUrl.endsWith("/")) cleanedUrl = cleanedUrl.substring(0, cleanedUrl.length - 1);
    return cleanedUrl;
}
