# SAP CPI MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an MCP client
(Claude Desktop, Claude Code, etc.) **monitor and manage SAP Cloud Integration (CPI / Integration
Suite)** through its **OData v1 APIs** — the same surface documented as the "Cloud Integration"
package on the SAP Business Accelerator Hub.

It runs locally over **stdio** or as an HTTP service you can deploy to **SAP BTP Cloud Foundry**.

**45 tools**: curated tools for the common workflows, plus generic escape-hatch tools
(`cpi_query`, `cpi_get_entity`, `cpi_invoke_function`, `cpi_write`) that reach **any** of the
~130 entity sets and 35 operations the API exposes.

---

## What it can do (tools)

### Monitoring — Message Processing Logs (MPL)
| Tool | Purpose |
|------|---------|
| `search_message_processing_logs` | Search/filter MPLs by status, flow, time window |
| `get_mpl_details` | Full MPL entry for a MessageGuid |
| `get_mpl_error_information` | Detailed error/exception text for a failed message |
| `get_mpl_custom_header_properties` | Custom header properties (business keys) |
| `get_mpl_run_steps` | Per-step run trace within a message |
| `get_message_store_entries` | Persisted payloads for a message |
| `get_failure_summary` | Failures grouped by integration flow (health dashboard) |
| `cancel_message_processing_log` ⚠️ | Cancel a processing/retrying message |

### Design-time content
| Tool | Purpose |
|------|---------|
| `list_integration_packages` / `get_integration_package` | Packages |
| `create_integration_package` ⚠️ / `delete_integration_package` ⚠️ | Package CRUD |
| `copy_integration_package` ⚠️ | Copy a standard/Discover package into the workspace |
| `list_integration_flows` / `get_integration_flow` | Integration flows |
| `create_integration_flow` ⚠️ | Create a new (empty) iFlow in a package |
| `save_integration_flow_as_version` ⚠️ | Save the flow draft as a new version (+ optional comment) |
| `download_integration_flow` | Download flow as base64 zip |
| `get_flow_configurations` / `update_flow_configuration` ⚠️ | Externalized parameters |
| `get_flow_resources` | Scripts/XSDs/WSDLs inside a flow |
| `where_used` | Search a word/string (e.g. a credential name, endpoint, or value) across flow content — process XML, adapter properties, scripts, mappings, parameter files — one package, one flow, or the whole tenant |

### Runtime & deployment
| Tool | Purpose |
|------|---------|
| `list_deployed_artifacts` / `get_deployed_artifact_status` | Deployed artifacts + status |
| `deploy_artifact` ⚠️ | Deploy iFlow / mapping / script / value-mapping / adapter |
| `undeploy_artifact` ⚠️ | Undeploy a running artifact |
| `get_build_and_deploy_status` | Async deploy task status |
| `list_service_endpoints` | Runtime endpoint URLs of deployed flows |

### Admin (security material, config, queues, B2B, logs)
| Tool | Purpose |
|------|---------|
| `list_user_credentials` / `deploy_user_credential` ⚠️ | User Credential security material |
| `list_oauth2_client_credentials` | OAuth2 client credentials |
| `list_keystore_entries` | Keystore certificates / key pairs |
| `list_number_ranges` / `create_number_range` ⚠️ | Number ranges |
| `list_data_stores` / `get_data_store_entries` | Data stores + entries |
| `list_variables` | Global/local variables |
| `list_jms_queues` | JMS queues (Enterprise plan; 501 on trial) |
| `list_partners` | Partner Directory partners |
| `list_log_files` | System log files |

### Generic — full API coverage
| Tool | Purpose |
|------|---------|
| `cpi_api_catalog` | Discover every entity set & function import |
| `cpi_query` | Read any entity set with `$filter/$orderby/$expand/...` |
| `cpi_get_entity` | Read one record by (single or composite) key |
| `cpi_invoke_function` ⚠️ | Invoke any function import |
| `cpi_write` ⚠️ | Create/update/delete any entity (DELETE needs `confirm=true`) |

⚠️ = write/destructive tool — requires `ALLOW_WRITE=true` (see below).

---

## Write safety

Read tools always work. **Write / deploy / delete tools only run when `ALLOW_WRITE=true`** is set
in your `.env`. In addition, **every write action requires an explicit `confirm=true`**: calling a
write tool without it returns an "Are you sure you want to …?" prompt and makes **no changes**.
Re-run the same tool with `confirm=true` to proceed. This gives a two-step confirmation for all
create/update/delete/deploy operations.

```
ALLOW_WRITE=false   # default — read-only
ALLOW_WRITE=true    # enable the ⚠️ tools
```

---

## Role-based access control (RBAC)

Three roles, layered on top of `ALLOW_WRITE`/`confirm=true` rather than replacing them:

| Role | Scope(s) granted | Can use |
|------|-------------------|---------|
| **Support** | `mcp.read` | Every read/list/search/download tool |
| **Developer** | `mcp.read`, `mcp.write` | The above, plus create/update/deploy tools |
| **Architect** | `mcp.read`, `mcp.write`, `mcp.delete` | Everything, including delete/undeploy and the generic `cpi_write` / `cpi_invoke_function` escape hatches |

The generic escape-hatch tools (`cpi_write`, `cpi_invoke_function`) are pinned to `mcp.delete`
regardless of the HTTP method or function called — they can reach operations (arbitrary
DELETE, or destructive function imports like `DeleteValMaps`) that the curated tools don't
expose, so they're Architect-only rather than Developer-only.

This only applies to the **HTTP transport with an XSUAA binding**. The static-token and open
modes grant full access to everyone (no per-user identity to hang a role off), and the
**stdio transport is unaffected** — it's a local subprocess with no role boundary, same as before.

### Setting it up in BTP

1. `xs-security.json` defines exactly three scopes and role templates — `Support`, `Developer`,
   `Architect`. There is no legacy/default role: a caller not assigned one of these three gets
   an empty scope set and no tools at all (see `resolveOauthScopes` in `src/auth.js`), not
   silent read-only access. Push the updated descriptor:
   ```bash
   cf update-service sap-cpi-mcp-xsuaa -c xs-security.json
   cf restage sap-cpi-mcp-server
   ```
2. In BTP Cockpit → your subaccount → **Security → Role Collections**, create three
   collections — `Architect`, `Developer`, `Support` — each pulling in the matching role
   template from the `sap-cpi-mcp` app.
3. Assign your team: either manually per user (Role Collection → Edit → add by email), or —
   if you already trust an IdP like Entra ID — map IdP groups to these Role Collections under
   **Security → Trust Configuration → your IdP → Role Collection Mappings**, so membership in
   an Entra group like `MCP-Architect` grants the collection automatically at login.
4. A user's token then carries whichever scopes their Role Collection grants; `src/auth.js`
   reads them off the verified JWT and `src/domains/helpers.js` enforces them per tool call.

### Testing a role change — watch for token caching

After moving a user between Role Collections, the change **will not show up** until they get a
genuinely new access token — MCP clients (including Claude.ai) cache the tool list and will
silently reuse a still-valid token via refresh rather than re-authenticating. `token-validity`
in `xs-security.json` is 3600s (1 hour), so a client can hold a stale scope set for up to an
hour after a role change.

To force a real re-check: fully **remove/delete the connector** in the client (not just
"Disconnect" — that alone may not clear the cached token) and re-add it from scratch, so it
goes through a brand-new OAuth login. Look for a "tools list refreshed"-style confirmation
after reconnecting, and check the tool count actually changed, before concluding a role
assignment didn't take effect.

---

## Securing the HTTP endpoint with OAuth 2.0 (XSUAA)

For the hosted (Cloud Foundry) endpoint, authentication is handled by `src/auth.js`:

1. **OAuth 2.0 (recommended)** — bind an **XSUAA** instance and the server requires a valid JWT:
   ```bash
   cf create-service xsuaa application sap-cpi-mcp-xsuaa -c xs-security.json
   cf bind-service sap-cpi-mcp-server sap-cpi-mcp-xsuaa
   cf restage sap-cpi-mcp-server
   cf create-service-key sap-cpi-mcp-xsuaa claude-connector   # -> clientid/secret/url for the client
   ```
   The server verifies the JWT signature against XSUAA's JWKS (`<uaa>/token_keys`) and checks the
   audience. A client obtains a token via `client_credentials` (or `authorization_code`) from
   `<uaa>/oauth/token` and calls `/mcp` with `Authorization: Bearer <jwt>`.
2. **Static token (dev/fallback)** — if no XSUAA is bound but `MCP_AUTH_TOKEN` is set, that static
   bearer token is required instead.
3. **Open** — if neither is configured, the endpoint is unauthenticated (local/PoC only).

Auth mode is auto-detected: XSUAA binding → OAuth; else `MCP_AUTH_TOKEN` → static; else open.
The **local stdio** transport is unaffected by all of this.

### OAuth discovery / authorize / token proxy (remote MCP clients)

Remote MCP OAuth clients (e.g. a Claude custom connector) resolve the authorization server
either via [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414) discovery at this origin, or —
if that's absent — by assuming `/authorize` and `/token` live on the MCP server's own host.
XSUAA's real endpoints live on a different host (the UAA tenant), so without help the client
gets a 404 hitting `<this-origin>/authorize` directly.

When an XSUAA binding is present, the server exposes:

| Route | Purpose |
|-------|---------|
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata pointing at the real XSUAA `authorization_endpoint` / `token_endpoint` |
| `GET /authorize` | Redirects to the real XSUAA `/oauth/authorize`, forwarding all query params (`client_id`, `redirect_uri`, `code_challenge`, `state`, ...) as-is |
| `POST /token` | Proxies the code/token exchange to the real XSUAA `/oauth/token` and relays its response verbatim |

If no XSUAA binding is found, these routes are not mounted and a warning is logged at startup.
This is purely a discovery/proxy convenience for OAuth clients — it does not replace the JWT
verification in `authMiddleware()`, which still gates every request to `/mcp`.

---

## 1. Get CPI API credentials (one-time)

The OData API is served by the **Process Integration Runtime** service.

1. In your BTP subaccount → **Instances and Subscriptions** → create an instance of
   **Process Integration Runtime** with plan **`api`**.
2. Under **Roles**, grant the roles you need, e.g.:
   - `MessageProcessingLogRead` (read MPLs)
   - `IntegrationContentRead` (read packages / design artifacts / deployed artifacts)
   - `MonitoringDataRead`
   - For the ⚠️ write tools (deploy/undeploy/create/delete): add the write/deploy roles too, e.g.
     `WorkspacePackagesEdit`, `WorkspaceArtifactsDeploy`, `MessageProcessingLogCustomHeaderRead`,
     and the relevant security-material roles.
3. Create a **Service Key** on that instance. From the key you get:
   - `url`      → your `CPI_BASE_URL` is `<url>/api/v1`
   - `tokenurl` → your `CPI_TOKEN_URL` (it already ends in `/oauth/token`)
   - `clientid` → `CPI_CLIENT_ID`
   - `clientsecret` → `CPI_CLIENT_SECRET`

---

## 2. Run locally (stdio) with Claude Desktop / Claude Code

```bash
npm install
cp .env.example .env      # then edit .env with your service-key values
```

Add to your MCP client config (Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sap-cpi": {
      "command": "node",
      "args": ["C:/path/to/sap-cpi-mcp-server/src/index.js"],
      "env": {
        "CPI_BASE_URL": "https://your-tenant.it-cpiXXX.cfapps.eu10.hana.ondemand.com/api/v1",
        "CPI_TOKEN_URL": "https://your-subdomain.authentication.eu10.hana.ondemand.com/oauth/token",
        "CPI_CLIENT_ID": "your-client-id",
        "CPI_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

For Claude Code:

```bash
claude mcp add sap-cpi -- node C:/path/to/sap-cpi-mcp-server/src/index.js
```

---

## 3. Deploy to SAP BTP Cloud Foundry (HTTP)

A full walkthrough of deploying this server as a Cloud Foundry app, securing it with XSUAA, and
connecting it to Claude as a custom connector — done entirely through the **BTP Cockpit web UI**
(a `cf` CLI equivalent is in [Appendix A](#appendix-a--equivalent-cf-cli-commands) below for
anyone who prefers the command line).

### What you will end up with

- A running Cloud Foundry application (`sap-cpi-mcp-server`) that exposes the MCP server over
  HTTPS at a `/mcp` endpoint.
- The application securely calling your SAP CPI tenant's OData APIs using OAuth client
  credentials.
- An XSUAA-protected front door, so only users assigned to an approved role collection can reach
  the MCP endpoint.
- Claude connected to that endpoint as a custom connector, able to call all 45 CPI tools directly
  from a chat.

### Architecture at a glance

| Component | Role |
|---|---|
| GitHub repository (`sap-cpi-mcp-server`) | Node.js MCP server source code — 45 tools for CPI monitoring and management. |
| Cloud Foundry application (`sap-cpi-mcp-server`) | Runs the MCP server as an HTTP service; exposes `/health` and `/mcp` endpoints. |
| Process Integration Runtime service key | OAuth client the app uses to call your CPI tenant's OData / monitoring APIs. |
| XSUAA service instance (`sap-cpi-mcp-server-xsuaa`) | Issues OAuth tokens that protect the `/mcp` endpoint from unauthenticated access. |
| Role Collections | Map SAP BTP users to Architect / Developer / Support levels of access on the MCP server (see [RBAC](#role-based-access-control-rbac) above). |
| Claude custom connector | Calls the deployed `/mcp` endpoint over HTTPS, authenticating via the XSUAA OAuth credentials. |

### Prerequisites

- An SAP BTP account (trial or licensed) with entitlement for Cloud Foundry Runtime and
  Authorization and Trust Management Service.
- Space Developer authorization on the target Cloud Foundry space.
- Rights to create a Process Integration Runtime service key on the CPI subaccount (for OAuth
  credentials).
- A Claude plan that supports custom connectors (Settings → Connectors).

### Part A — Package the MCP Server for Deployment

#### Step 1 — Download the Source Code

Open this GitHub repository and download the project as a ZIP archive.

- Click **Code → Download ZIP**.


*Figure 1 — The sap-cpi-mcp-server GitHub repository, Code → Download ZIP.*

#### Step 2 — Prepare the Deployment ZIP

Cloud Foundry's build pack looks for `package.json` at the root of the uploaded archive.
GitHub's downloaded ZIP wraps everything inside a folder (e.g., `sap-cpi-mcp-server-main/`), so
it needs to be re-zipped.

1. Extract the downloaded ZIP and open the extracted folder.
2. Select `package.json`, `package-lock.json` and the `src` folder (do not select the enclosing
   folder itself).
3. Right-click → **Send to → Compressed (zipped) folder**, and name it `sap-cpi-mcp-server.zip`.


*Figure 2 — Selecting package.json, package-lock.json and src, then Send to → Compressed (zipped)
folder.*

> ⚠️ **Watch out:** If you instead zip the whole extracted folder, `package.json` ends up one
> level too deep and staging will fail with a "module not found" style error. Verify the new zip
> opens straight into `package.json`, `src/`, etc. — not into another folder.

### Part B — Set Up Cloud Foundry on SAP BTP

#### Step 3 — Enable the Cloud Foundry Environment

In the BTP Cockpit, open your subaccount's Overview page. If Cloud Foundry hasn't been enabled
yet, do so from here.


*Figure 3 — Subaccount Overview, with the Cloud Foundry Environment panel and Enable Cloud
Foundry.*


*Figure 4 — Cloud Foundry Environment details: API endpoint, org name/ID, and the Spaces list.*

#### Step 4 — Create Space

Click **Create Space** (top-right of the Spaces panel shown above) and name it — for example,
`dev`. This is the space you will deploy the application into.

### Part C — Deploy the Application

#### Step 5 — Deploy via BTP Cockpit

Open the `dev` space → **Applications** and click **Deploy Application**.


*Figure 5 — The Deploy Application dialog: File location, Deploy with (Manifest/Custom
Settings), Manifest location.*

1. Upload the re-zipped file (`sap-cpi-mcp-server.zip`) at **File location**.
2. Keep **Deploy with** set to **Manifest**.
3. Browse to `manifest.yml` from the extracted folder for **Manifest location**.
4. Keep **Start application after deploy** checked, then click **Deploy**.


*Figure 6 — Dialog filled in with sap-cpi-mcp-server.zip and manifest.yml, ready to deploy.*

#### Step 6 — Confirm the Application Is Running

Once deployment finishes, the application appears in the Applications list with a **Started**
state.


*Figure 7 — Applications (1): sap-cpi-mcp-server, Requested State: Started.*

Open it to see the Application Overview — buildpack, stack, and the Mapped Routes section with
the public HTTPS URL Cloud Foundry assigned to the app.


*Figure 8 — Application Overview showing the nodejs_buildpack, cflinuxfs4 stack, and the Mapped
Route.*

#### Step 7 — Verify with a Health Check

Open the Mapped Route link from Step 6 and append `/health` to it. A healthy deployment returns
a small JSON payload confirming the server name, version, and an "ok" status.


*Figure 9 — GET /health returning `{ "status": "ok", "server": { "name": "sap-cpi-mcp-server",
"version": "1.0.0" } }`.*

### Part D — Connect the App to Your SAP CPI Tenant

#### Step 8 — Create a Process Integration Runtime Service Key

The app needs its own OAuth client to call your CPI tenant's OData APIs — see
[1. Get CPI API credentials](#1-get-cpi-api-credentials-one-time) above for how to create it and
which fields map to which env var.

#### Step 9 — Configure Environment Variables

In the application, go to **User-Provided Variables** and click **Create Variable** for each of
`CPI_BASE_URL`, `CPI_TOKEN_URL`, `CPI_CLIENT_ID`, `CPI_CLIENT_SECRET`, `MCP_TRANSPORT=http`, and
`ALLOW_WRITE` (keep `false` unless the connector should be allowed to write):


*Figure 10 — User-Provided Variables: ALLOW_WRITE, CPI_BASE_URL, CPI_CLIENT_ID,
CPI_CLIENT_SECRET, CPI_TOKEN_URL, MCP_TRANSPORT.*

#### Step 10 — Restage the Application

Environment variable changes only take effect after a restage.


*Figure 11 — Restage Application: "Restaging will cause application downtime."*


*Figure 12 — Application Overview after restage, confirming the app is Started and the route is
live.*

### Part E — Secure the Endpoint with XSUAA

#### Step 11 — Create the XSUAA Service Instance

In **Service Marketplace**, search for **Authorization and Trust Management Service** and click
**Create**.

1. Plan: **application**, Runtime Environment: **Cloud Foundry**, Space: **dev**.
2. Instance Name: `sap-cpi-mcp-server-xsuaa`.


*Figure 13 — New Instance or Subscription: Authorization and Trust Management Service, plan
application.*

3. On the **Parameters** step, paste the contents of `xs-security.json` from the extracted
   folder — this defines the app's `xsappname` and its OAuth scopes (`mcp.read`, `mcp.write`,
   `mcp.delete`).
4. Click **Create**.


*Figure 14 — Parameters step with the xs-security.json scopes and descriptions pasted in.*

#### Step 12 — Generate a Service Key for the Claude Connector

Open the new `sap-cpi-mcp-server-xsuaa` instance → **Service Keys → Create**. These credentials
are what Claude will use to authenticate to the MCP endpoint.


*Figure 15 — New Service Key dialog for the XSUAA instance.*

Open the key's Credentials (JSON view) to retrieve `clientid`, `clientsecret` and `url` — keep
this panel handy for Part F.

*Figure 16 — Service key credentials: clientid, clientsecret, url, identityzone, tenantid, etc.*

> 🔒 Treat this credentials panel like a password screen — don't leave it visible in a
> screenshot or screen share.

#### Step 13 — Bind XSUAA to the Application

In the application, go to **Service Bindings → Bind Service Instance**, choose
`sap-cpi-mcp-server-xsuaa`, and confirm the binding.


*Figure 17 — Bind Service Instance: selecting sap-cpi-mcp-server-xsuaa (service: xsuaa, plan:
application).*

> **Note:** Restart or restage the app again after binding so it picks up the new
> `VCAP_SERVICES` credentials.

#### Step 14 — Create Role Collections

Under **Security → Role Collections**, create one collection per role template in
`xs-security.json` (`Support`, `Developer`, `Architect` — see [RBAC](#role-based-access-control-rbac)
above).


*Figure 18 — Create Role Collection: SapCpiMcp.Architect, mapped to the Architect role template.*


*Figure 19 — Three role collections created: SapCpiMcp.Architect, .Developer and .Support.*

#### Step 15 — Assign Users to Role Collections

Open the relevant Role Collection and add each user under its **Users** tab — this determines
what that person (or the account they sign in with when connecting Claude) is allowed to do
through the MCP server.

*Figure 20 — SapCpiMcp.Support role collection, with the Support role template and an assigned
user.*

### Part F — Connect to Claude

#### Step 16 — Add a Custom Connector in Claude

In Claude, go to **Settings → Connectors → Add → Add custom connector**.


*Figure 21 — Add custom connector: Name, Remote MCP Server URL, and Advanced settings for OAuth
Client ID/Secret.*

#### Step 17 — Get the Remote MCP Server URL

Back in the Cockpit, open the application's Application Overview and copy the Mapped Routes URL,
then append `/mcp` to it — e.g. `https://sap-cpi-mcp-server.cfapps.<region>.hana.ondemand.com/mcp`.


*Figure 22 — Application Overview with the Mapped Route to copy (append /mcp when pasting into
Claude).*

#### Step 18 — Get the OAuth Client ID & Secret

Open the service key you created in Step 12 and copy its `clientid` and `clientsecret` into the
connector's **OAuth Client ID / OAuth Client Secret** fields.

#### Step 19 — Connect and Authenticate

Click **Add**, then **Connect**.


*Figure 24 — Connector added, showing the /mcp URL and a Connect button before authentication.*

1. Claude redirects to your SAP identity provider's login page.
2. Sign in with an account that has been assigned one of the `SapCpiMcp` role collections from
   Step 15.
3. Once authenticated, the connector shows as connected and all 45 MCP tools become available to
   Claude.

### Verification

Confirm the end-to-end connection with two quick prompts in a new Claude chat:

**"List out the tools available in the SAP CPI MCP server."**


*Figure 25 — Claude listing the full MCP tool catalog: discovery/catalog, packages & flows,
deployment & runtime status, and more.*

**"List out the deployed interfaces."**


*Figure 26 — Claude calling list_deployed_artifacts and returning the tenant's actual deployed
integration flow(s).*

Both responses coming back with live tenant data confirm the full chain is working: **Claude →
XSUAA-authenticated /mcp endpoint → Cloud Foundry app → SAP CPI OData API.**

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Staging fails / buildpack can't find `package.json` | The re-zipped archive still has a wrapping folder (e.g., `sap-cpi-mcp-server-main/package.json`). | Re-zip so `package.json`, `src/`, etc. sit at the root of the archive — see Step 2. |
| App deploys but `/health` doesn't return status ok, or the app shows CRASHED | `MCP_TRANSPORT` isn't set to `http`, or the app wasn't restaged after the variable was added. | Check the app's Logs tab; confirm `MCP_TRANSPORT=http` is set, then restage (Step 10). |
| Claude connector returns 401/403 after login | The signed-in user isn't in any `SapCpiMcp` role collection, or the XSUAA instance isn't bound to the app. | Confirm Service Bindings shows `sap-cpi-mcp-server-xsuaa` bound (Step 13), and assign the user to a role collection (Step 15). |
| App is Running but CPI calls fail with 401 | `CPI_BASE_URL` / `CPI_CLIENT_ID` / `CPI_CLIENT_SECRET` are wrong, expired, or the service key lacks the required roles. | Recreate the Process Integration Runtime service key with the roles listed in Step 8, update the variables, and restage. |

### Appendix A — Equivalent CF CLI commands

```bash
cf login -a https://api.cf.<region>.hana.ondemand.com
cf target -o <org> -s <space>

cf push --no-start

cf set-env sap-cpi-mcp-server CPI_BASE_URL "https://<tenant>/api/v1"
cf set-env sap-cpi-mcp-server CPI_TOKEN_URL "https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token"
cf set-env sap-cpi-mcp-server CPI_CLIENT_ID "<clientid>"
cf set-env sap-cpi-mcp-server CPI_CLIENT_SECRET "<clientsecret>"
cf set-env sap-cpi-mcp-server MCP_TRANSPORT "http"
cf set-env sap-cpi-mcp-server ALLOW_WRITE "false"

cf create-service xsuaa application sap-cpi-mcp-xsuaa -c xs-security.json
cf bind-service sap-cpi-mcp-server sap-cpi-mcp-xsuaa

cf start sap-cpi-mcp-server

cf create-service-key sap-cpi-mcp-xsuaa sap-cpi-mcp-xsuaa-key
```

> The service key from the last command supplies the `clientid`, `clientsecret` and `tokenurl`
> to paste into Claude's custom connector — the same values Steps 12 and 18 retrieve through the
> Cockpit UI. For a simpler dev-only setup without XSUAA, `MCP_AUTH_TOKEN` (a static shared
> secret) still works as a fallback auth mode — see
> [Securing the HTTP endpoint](#securing-the-http-endpoint-with-oauth-20-xsuaa) above.

---

## 4. Example prompts once connected

- "Show me all failed messages in the last 4 hours."
- "Give me a failure summary for the last 24 hours grouped by integration flow."
- "Get the error details for MessageGuid `AGh...`."
- "List integration flows in package `MyIntegrationPackage` and tell me which are deployed."
- "Is the `OrderReplication` flow deployed and started? If not, why?"

---

## Notes on the CPI OData API

- Collection base: `.../api/v1`
- MPLs: `/MessageProcessingLogs` — filter with `$filter`, sort with `$orderby=LogEnd desc`.
- Error text: `/MessageProcessingLogs('<guid>')/ErrorInformation/$value` (plain text).
- Packages: `/IntegrationPackages`, flows: `/IntegrationDesigntimeArtifacts`.
- Deployed: `/IntegrationRuntimeArtifacts`.
- Time filters use OData datetime literals: `LogEnd gt datetime'2024-01-01T00:00:00'`.

Requires **Node.js 18+** (uses the built-in `fetch`).
