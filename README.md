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

1. `xs-security.json` already defines the scopes and role templates (`Support`, `Developer`,
   `Architect` — plus the legacy `CpiMcpUser`/`Use` scope, kept so anyone already assigned it
   keeps working, treated as read-only). Push the updated descriptor:
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

```bash
cf login -a https://api.cf.<region>.hana.ondemand.com
cf target -o <org> -s <space>

# Edit manifest.yml OR set secrets as environment variables:
cf push --no-start

cf set-env sap-cpi-mcp-server CPI_BASE_URL    "https://.../api/v1"
cf set-env sap-cpi-mcp-server CPI_TOKEN_URL   "https://.../oauth/token"
cf set-env sap-cpi-mcp-server CPI_CLIENT_ID   "..."
cf set-env sap-cpi-mcp-server CPI_CLIENT_SECRET "..."
cf set-env sap-cpi-mcp-server MCP_AUTH_TOKEN  "a-long-random-secret"   # optional gate

cf start sap-cpi-mcp-server
```

The MCP endpoint will be:

```
https://sap-cpi-mcp-server.cfapps.<region>.hana.ondemand.com/mcp
```

Connect an HTTP-capable MCP client:

```json
{
  "mcpServers": {
    "sap-cpi": {
      "type": "http",
      "url": "https://sap-cpi-mcp-server.cfapps.<region>.hana.ondemand.com/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

> **Security note:** `MCP_AUTH_TOKEN` is a simple shared-secret gate for getting started.
> For production, front the app with the SAP **Application Router + XSUAA** for proper
> OAuth2/JWT protection, and bind credentials via a service instance rather than plain env vars.

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
