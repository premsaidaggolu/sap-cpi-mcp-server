// Admin domain: security material, number ranges, data stores, variables,
// JMS queues, partner directory, log files. High-value curated tools; the long
// tail of entities is reachable via the generic tools (cpi_query / cpi_write / cpi_invoke).
import { z } from "zod";
import { cpiGet, cpiRequest, odataString, odataKey } from "../cpiClient.js";
import { readHandler, writeHandler } from "./helpers.js";

export function registerAdminTools(server) {
  // --- Security material --------------------------------------------------
  server.registerTool(
    "list_user_credentials",
    {
      title: "List User Credentials (Security Material)",
      description: "List deployed User Credential security artifacts (names/metadata only, no secrets).",
      inputSchema: { top: z.number().int().min(1).max(500).default(100) },
    },
    readHandler(({ top }) => cpiGet("/UserCredentials", { $top: top }))
  );

  server.registerTool(
    "deploy_user_credential",
    {
      title: "Deploy User Credential",
      description:
        "Create/deploy a User Credential security artifact. Requires ALLOW_WRITE. The secret is " +
        "write-only and cannot be read back.",
      inputSchema: {
        name: z.string(),
        user: z.string(),
        password: z.string(),
        description: z.string().optional(),
        kind: z.enum(["default", "successfactors", "openconnectors"]).default("default"),
        confirm: z.boolean().optional().describe("Must be true to proceed."),
      },
    },
    writeHandler(
      ({ name, user, password, description, kind }) =>
        cpiRequest("POST", "/UserCredentials", {
          body: { Name: name, Kind: kind, Description: description || "", User: user, Password: password },
        }),
      { action: ({ name }) => `deploy user credential '${name}'` }
    )
  );

  server.registerTool(
    "list_oauth2_client_credentials",
    {
      title: "List OAuth2 Client Credentials",
      description: "List deployed OAuth2 Client Credential security artifacts (metadata only).",
      inputSchema: { top: z.number().int().min(1).max(500).default(100) },
    },
    readHandler(({ top }) => cpiGet("/OAuth2ClientCredentials", { $top: top }))
  );

  server.registerTool(
    "list_keystore_entries",
    {
      title: "List Keystore Entries (Certificates)",
      description: "List entries (certificates / key pairs) in the tenant keystore.",
      inputSchema: { top: z.number().int().min(1).max(500).default(200) },
    },
    readHandler(({ top }) => cpiGet("/KeystoreEntries", { $top: top }))
  );

  // --- Number ranges ------------------------------------------------------
  server.registerTool(
    "list_number_ranges",
    {
      title: "List Number Ranges",
      description: "List configured number range objects.",
      inputSchema: {},
    },
    readHandler(() => cpiGet("/NumberRanges"))
  );

  server.registerTool(
    "create_number_range",
    {
      title: "Create Number Range",
      description: "Create a number range object. Requires ALLOW_WRITE.",
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        minValue: z.number().int().default(0),
        maxValue: z.number().int().default(1000000),
        currentValue: z.number().int().default(0),
        rotate: z.boolean().default(false),
        fieldLength: z.number().int().default(10),
        confirm: z.boolean().optional().describe("Must be true to proceed."),
      },
    },
    writeHandler(
      ({ name, description, minValue, maxValue, currentValue, rotate, fieldLength }) =>
        cpiRequest("POST", "/NumberRanges", {
          body: {
            Name: name,
            Description: description || "",
            MinValue: String(minValue),
            MaxValue: String(maxValue),
            CurrentValue: String(currentValue),
            Rotate: String(rotate),
            FieldLength: String(fieldLength),
          },
        }),
      { action: ({ name }) => `create number range '${name}'` }
    )
  );

  // --- Data stores --------------------------------------------------------
  server.registerTool(
    "list_data_stores",
    {
      title: "List Data Stores",
      description: "List data stores (transient/persistent message persistence used by flows).",
      inputSchema: { top: z.number().int().min(1).max(500).default(100) },
    },
    readHandler(({ top }) => cpiGet("/DataStores", { $top: top }))
  );

  server.registerTool(
    "get_data_store_entries",
    {
      title: "Get Data Store Entries",
      description:
        "List the entries in a specific data store. IntegrationFlow is the flow Id (empty for a global store).",
      inputSchema: {
        dataStoreName: z.string(),
        integrationFlow: z.string().default(""),
        type: z.string().default("default"),
        top: z.number().int().min(1).max(500).default(100),
      },
    },
    readHandler(({ dataStoreName, integrationFlow, type, top }) =>
      cpiGet(
        `/DataStores${odataKey({ DataStoreName: dataStoreName, IntegrationFlow: integrationFlow, Type: type })}/Entries`,
        { $top: top }
      )
    )
  );

  // --- Variables ----------------------------------------------------------
  server.registerTool(
    "list_variables",
    {
      title: "List Variables",
      description: "List global and local variables persisted by integration flows.",
      inputSchema: { top: z.number().int().min(1).max(500).default(100) },
    },
    readHandler(({ top }) => cpiGet("/Variables", { $top: top }))
  );

  // --- Queues -------------------------------------------------------------
  server.registerTool(
    "list_jms_queues",
    {
      title: "List JMS Queues",
      description: "List JMS queues and their state (capacity, message counts).",
      inputSchema: {},
    },
    readHandler(() => cpiGet("/JmsQueues"))
  );

  // --- Partner Directory (B2B) -------------------------------------------
  server.registerTool(
    "list_partners",
    {
      title: "List Partner Directory Partners",
      description: "List partners registered in the Partner Directory.",
      inputSchema: { top: z.number().int().min(1).max(500).default(100) },
    },
    readHandler(({ top }) => cpiGet("/Partners", { $top: top }))
  );

  // --- Logs ---------------------------------------------------------------
  server.registerTool(
    "list_log_files",
    {
      title: "List System Log Files",
      description: "List available system log files (http, trace, etc.) for the tenant worker nodes.",
      inputSchema: {},
    },
    readHandler(() => cpiGet("/LogFiles"))
  );
}
