// Generic escape-hatch tools. These reach ANY entity set / function import in the
// CPI OData API, so the whole SAP Business Accelerator Hub "Cloud Integration"
// surface is covered even where there is no curated tool.
import { z } from "zod";
import { cpiGet, cpiRequest, cpiInvoke, odataKey } from "../cpiClient.js";
import { readHandler, writeHandler } from "./helpers.js";

// Discovered from this tenant's $metadata (com.sap.hci.api).
const ENTITY_SETS = [
  "IntegrationPackages", "IntegrationDesigntimeArtifacts", "MessageMappingDesigntimeArtifacts",
  "ValueMappingDesigntimeArtifacts", "ScriptCollectionDesigntimeArtifacts", "DataTypeDesigntimeArtifacts",
  "MessageTypeDesigntimeArtifacts", "FaultMessageTypeDesigntimeArtifacts", "ServiceInterfaceDesigntimeArtifacts",
  "IntegrationAdapterDesigntimeArtifacts", "Configurations", "Resources", "CustomTags", "CustomTagConfigurations",
  "ServiceEndpoints", "EntryPoints", "IntegrationFlows", "APIDefinitions", "IntegrationConnections",
  "DesignGuidelines", "DesignGuidelineExecutionResults", "IntegrationDesigntimeLocks", "BuildAndDeployStatus",
  "DefaultValMaps", "ValMaps", "ValMapSchema", "NumberRanges",
  "IntegrationRuntimeArtifacts", "RuntimeArtifactErrorInformations", "RuntimeSyncInfos",
  "MessageProcessingLogs", "MessageProcessingLogErrorInformations", "MessageProcessingLogAdapterAttributes",
  "MessageProcessingLogCustomHeaderProperties", "MessageProcessingLogRuns", "MessageProcessingLogRunSteps",
  "MessageProcessingLogRunStepProperties", "MessageProcessingLogAttachments",
  "MessageStoreEntries", "MessageStoreEntryProperties", "MessageStoreEntryAttachments",
  "MessageStoreEntryAttachmentProperties", "TraceMessages", "TraceMessageProperties", "TraceMessageExchangeProperties",
  "DataStores", "DataStoreEntries", "Variables", "Locks",
  "JmsMessages", "Queues", "JmsQueues", "JmsBrokers", "JmsArtifacts", "QueueStates", "MessagingQueues", "MessagingMessages",
  "IdempotentRepositoryEntries", "GenericIdempotentRepositoryEntries",
  "Partners", "AlternativePartners", "StringParameters", "BinaryParameters", "AuthorizedUsers",
  "BusinessDocuments", "BusinessDocumentRelations", "BusinessDocumentPayloads", "BusinessDocumentNotes",
  "BusinessDocumentProcessingEvents", "BusinessDocumentExtFields", "OrphanedInterchanges",
  "FunctionalAcknowledgements", "TechnicalAcknowledgements", "B2BArchivingConfigurations",
  "B2BArchivingKeyPerformanceIndicators", "IdMapFromIds", "IdMapToIds",
  "UserCredentials", "UserCredentialParameters", "OAuth2ClientCredentials", "OAuth2AuthorizationCodes",
  "SecureParameters", "CustomParameters", "SecurityArtifacts", "AccessPolicies", "AccessPolicyRuntimeAssignments",
  "Keystores", "KeystoreEntries", "HistoryKeystoreEntries", "KeystoreResources", "KeyPairResources",
  "ChainCertificates", "CertificateResources", "CertificateChainResources", "CertificateSigningRequests",
  "KeyPairGenerationRequests", "SSHKeyResources", "SSHKeyGenerationRequests", "RSAKeyGenerationRequests",
  "PgpKeyrings", "PgpPublicKeyrings", "PgpSecretKeyrings", "PgpKeyEntries", "PgpUserIds", "PgpSubKeys",
  "LogFiles", "LogFileArchives", "AuditLogs", "ArchivingConfigurations", "ArchivingKeyPerformanceIndicators",
  "ExternalLoggingActivationStatus", "ExternalLoggingEvents", "ArtifactReferences",
];

const FUNCTION_IMPORTS = [
  { name: "DeployIntegrationDesigntimeArtifact", method: "POST", params: "Id, Version" },
  { name: "DeployMessageMappingDesigntimeArtifact", method: "POST", params: "Id, Version" },
  { name: "DeployValueMappingDesigntimeArtifact", method: "POST", params: "Id, Version" },
  { name: "DeployScriptCollectionDesigntimeArtifact", method: "POST", params: "Id, Version" },
  { name: "DeployIntegrationAdapterDesigntimeArtifact", method: "POST", params: "Id, Version" },
  { name: "CopyIntegrationPackage", method: "POST", params: "Id" },
  { name: "ValidateIntegrationDesigntimeArtifact", method: "POST", params: "Id, Version" },
  { name: "IntegrationDesigntimeArtifactSaveAsVersion", method: "POST", params: "Id, SaveAsVersion" },
  { name: "MessageMappingDesigntimeArtifactSaveAsVersion", method: "POST", params: "Id, SaveAsVersion" },
  { name: "ScriptCollectionDesigntimeArtifactSaveAsVersion", method: "POST", params: "Id, SaveAsVersion" },
  { name: "ExecuteIntegrationDesigntimeArtifactsGuidelines", method: "POST", params: "Id, Version" },
  { name: "CancelMessageProcessingLog", method: "POST", params: "MessageGuid" },
  { name: "RetryMessagingMessages", method: "POST", params: "(message selector)" },
  { name: "MoveMessagingMessages", method: "POST", params: "(message selector)" },
  { name: "activateQueue", method: "POST", params: "(queue)" },
  { name: "deactivateQueue", method: "POST", params: "(queue)" },
  { name: "UpsertValMaps", method: "POST", params: "value-mapping payload" },
  { name: "UpdateDefaultValMap", method: "POST", params: "value-mapping payload" },
  { name: "DeleteValMaps", method: "POST", params: "value-mapping selector" },
  { name: "activateExternalLogging", method: "POST", params: "(node)" },
  { name: "deactivateExternalLogging", method: "POST", params: "(node)" },
  { name: "activateArchivingConfiguration", method: "POST", params: "-" },
  { name: "activateB2BArchivingConfiguration", method: "POST", params: "-" },
  { name: "massInterchangeProcess", method: "POST", params: "(B2B selector)" },
  { name: "singleInterchangeProcess", method: "POST", params: "(B2B selector)" },
  { name: "OAuth2AuthorizationCodeCopy", method: "POST", params: "Name" },
  { name: "OAuth2AuthorizationCodeFullAuthUrl", method: "POST", params: "Name" },
  { name: "OAuth2AuthorizationCodeRefreshTokenUpdate", method: "POST", params: "Name" },
  { name: "OAuthTokenFromCode", method: "GET", params: "code" },
];

export function registerGenericTools(server) {
  server.registerTool(
    "cpi_api_catalog",
    {
      title: "CPI API Catalog (discover entity sets & operations)",
      description:
        "List every OData entity set and function import this CPI tenant exposes. Use this to discover " +
        "what cpi_query / cpi_get_entity / cpi_invoke_function / cpi_write can target.",
      inputSchema: { filter: z.string().optional().describe("Optional case-insensitive substring filter.") },
    },
    readHandler(({ filter }) => {
      const f = (filter || "").toLowerCase();
      return {
        entitySets: ENTITY_SETS.filter((s) => !f || s.toLowerCase().includes(f)),
        functionImports: FUNCTION_IMPORTS.filter(
          (x) => !f || x.name.toLowerCase().includes(f)
        ),
        note: "Use cpi_query for collections, cpi_get_entity for one record, cpi_invoke_function for operations, cpi_write for create/update/delete.",
      };
    })
  );

  server.registerTool(
    "cpi_query",
    {
      title: "CPI Query (read any entity set)",
      description:
        "Run a read query against ANY CPI OData entity set with standard OData options. " +
        "Example: entitySet='MessageProcessingLogs', filter=\"Status eq 'FAILED'\", orderby='LogEnd desc'.",
      inputSchema: {
        entitySet: z.string().describe("e.g. IntegrationPackages, KeystoreEntries, DataStores"),
        filter: z.string().optional().describe("OData $filter expression (pre-quote string literals)."),
        select: z.string().optional().describe("$select comma list."),
        expand: z.string().optional().describe("$expand comma list."),
        orderby: z.string().optional(),
        top: z.number().int().min(1).max(1000).default(50),
        skip: z.number().int().min(0).optional(),
      },
    },
    readHandler(({ entitySet, filter, select, expand, orderby, top, skip }) => {
      const query = { $top: top };
      if (filter) query.$filter = filter;
      if (select) query.$select = select;
      if (expand) query.$expand = expand;
      if (orderby) query.$orderby = orderby;
      if (skip !== undefined) query.$skip = skip;
      return cpiGet(`/${entitySet.replace(/^\//, "")}`, query);
    })
  );

  server.registerTool(
    "cpi_get_entity",
    {
      title: "CPI Get Entity (read one record by key)",
      description:
        "Get a single entity by key. Use 'key' for a single-key entity (e.g. package Id), or 'keys' " +
        "(object) for composite keys (e.g. {Id:'x',Version:'active'}). Optionally fetch a navigation property.",
      inputSchema: {
        entitySet: z.string(),
        key: z.string().optional().describe("Single key value."),
        keys: z.record(z.string()).optional().describe("Composite key object."),
        navigation: z.string().optional().describe("Navigation property to follow, e.g. 'Configurations'."),
        raw: z.boolean().default(false).describe("Return raw text (use for /$value endpoints)."),
      },
    },
    readHandler(({ entitySet, key, keys, navigation, raw }) => {
      const keyPart = keys ? odataKey(keys) : odataKey(key);
      const nav = navigation ? `/${navigation}` : "";
      return cpiGet(`/${entitySet.replace(/^\//, "")}${keyPart}${nav}`, {}, { raw });
    })
  );

  server.registerTool(
    "cpi_invoke_function",
    {
      title: "CPI Invoke Function Import (run any operation)",
      description:
        "Invoke any OData function import (see cpi_api_catalog). String parameters are auto-quoted. " +
        "Requires ALLOW_WRITE (most function imports change tenant state).",
      inputSchema: {
        functionName: z.string(),
        params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
        method: z.enum(["POST", "GET"]).default("POST"),
        confirm: z.boolean().optional().describe("Must be true to proceed."),
      },
    },
    writeHandler(({ functionName, params, method }) => cpiInvoke(functionName, params || {}, method), {
      action: ({ functionName }) => `invoke function import '${functionName}'`,
    })
  );

  server.registerTool(
    "cpi_write",
    {
      title: "CPI Write (create/update/delete any entity)",
      description:
        "Low-level create/update/delete against any CPI OData path. Requires ALLOW_WRITE. " +
        "Every call (POST/PUT/DELETE/MERGE) requires confirm=true. Provide 'path' relative to " +
        "/api/v1 (e.g. \"/IntegrationPackages('X')\").",
      inputSchema: {
        method: z.enum(["POST", "PUT", "DELETE", "MERGE"]),
        path: z.string().describe("Path relative to /api/v1, e.g. /NumberRanges or /Variables(...)."),
        body: z.record(z.any()).optional().describe("Request body object (for POST/PUT/MERGE)."),
        confirm: z.boolean().optional().describe("Required true for every call, not just DELETE."),
      },
    },
    writeHandler(({ method, path, body }) => cpiRequest(method, path.startsWith("/") ? path : `/${path}`, { body }), {
      action: ({ method, path }) => `${method} ${path}`,
    })
  );
}
