// Design-time content domain: packages, integration flows, mappings, script
// collections, configurations, resources.
import { z } from "zod";
import { cpiGet, cpiRequest, cpiInvoke, odataString } from "../cpiClient.js";
import { readHandler, writeHandler } from "./helpers.js";

export function registerContentTools(server) {
  // --- Packages -----------------------------------------------------------
  server.registerTool(
    "list_integration_packages",
    {
      title: "List Integration Packages",
      description: "List all integration packages in the tenant's design workspace.",
      inputSchema: { top: z.number().int().min(1).max(500).default(100) },
    },
    readHandler(({ top }) => cpiGet("/IntegrationPackages", { $top: top }))
  );

  server.registerTool(
    "get_integration_package",
    {
      title: "Get Integration Package",
      description: "Get details of a single integration package by Id.",
      inputSchema: { packageId: z.string() },
    },
    readHandler(({ packageId }) => cpiGet(`/IntegrationPackages(${odataString(packageId)})`))
  );

  server.registerTool(
    "create_integration_package",
    {
      title: "Create Integration Package",
      description: "Create a new integration package. Requires ALLOW_WRITE.",
      inputSchema: {
        id: z.string().describe("Technical Id (no spaces)."),
        name: z.string(),
        shortText: z.string().optional(),
        description: z.string().optional(),
        confirm: z.boolean().optional().describe("Must be true to proceed."),
      },
    },
    writeHandler(
      ({ id, name, shortText, description }) =>
        cpiRequest("POST", "/IntegrationPackages", {
          body: { Id: id, Name: name, ShortText: shortText || name, Description: description || "" },
        }),
      { action: ({ id }) => `create integration package '${id}'` }
    )
  );

  server.registerTool(
    "delete_integration_package",
    {
      title: "Delete Integration Package",
      description:
        "Delete an integration package and all its artifacts. Requires ALLOW_WRITE and confirm=true.",
      inputSchema: { packageId: z.string(), confirm: z.boolean().optional() },
    },
    writeHandler(({ packageId }) => cpiRequest("DELETE", `/IntegrationPackages(${odataString(packageId)})`), {
      destructive: ({ packageId }) => `delete package '${packageId}' and everything in it`,
    })
  );

  server.registerTool(
    "copy_integration_package",
    {
      title: "Copy Integration Package (from Hub / Discover)",
      description:
        "Copy a standard/partner package (e.g. from the Discover catalog) into the design workspace. " +
        "Requires ALLOW_WRITE.",
      inputSchema: {
        packageId: z.string().describe("Id of the package to copy."),
        confirm: z.boolean().optional().describe("Must be true to proceed."),
      },
    },
    writeHandler(({ packageId }) => cpiInvoke("CopyIntegrationPackage", { Id: packageId }), {
      action: ({ packageId }) => `copy package '${packageId}' into the design workspace`,
    })
  );

  // --- Integration flows (design-time artifacts) --------------------------
  server.registerTool(
    "list_integration_flows",
    {
      title: "List Integration Flows in a Package",
      description: "List the integration flow design-time artifacts in a package.",
      inputSchema: { packageId: z.string() },
    },
    readHandler(({ packageId }) =>
      cpiGet(`/IntegrationPackages(${odataString(packageId)})/IntegrationDesigntimeArtifacts`)
    )
  );

  server.registerTool(
    "get_integration_flow",
    {
      title: "Get Integration Flow Details",
      description: "Get a design-time integration flow artifact by Id and Version.",
      inputSchema: {
        artifactId: z.string(),
        version: z.string().default("active"),
      },
    },
    readHandler(({ artifactId, version }) =>
      cpiGet(
        `/IntegrationDesigntimeArtifacts(Id=${odataString(artifactId)},Version=${odataString(version)})`
      )
    )
  );

  server.registerTool(
    "download_integration_flow",
    {
      title: "Download Integration Flow (base64 zip)",
      description:
        "Download the integration flow content as a base64-encoded zip ($value). Useful for backup/transport.",
      inputSchema: { artifactId: z.string(), version: z.string().default("active") },
    },
    readHandler(async ({ artifactId, version }) => {
      const b64 = await cpiGet(
        `/IntegrationDesigntimeArtifacts(Id=${odataString(artifactId)},Version=${odataString(version)})/$value`,
        {},
        { raw: true }
      );
      return { artifactId, version, encoding: "base64", contentLength: b64.length, content: b64 };
    })
  );

  // --- Configurations (externalized parameters) ---------------------------
  server.registerTool(
    "get_flow_configurations",
    {
      title: "Get Flow Externalized Configurations",
      description:
        "Get the externalized configuration parameters of an integration flow (endpoints, credentials names, etc.).",
      inputSchema: { artifactId: z.string(), version: z.string().default("active") },
    },
    readHandler(({ artifactId, version }) =>
      cpiGet(
        `/IntegrationDesigntimeArtifacts(Id=${odataString(artifactId)},Version=${odataString(version)})/Configurations`
      )
    )
  );

  server.registerTool(
    "update_flow_configuration",
    {
      title: "Update Flow Configuration Parameter",
      description:
        "Update a single externalized configuration parameter of an integration flow. Requires ALLOW_WRITE.",
      inputSchema: {
        artifactId: z.string(),
        version: z.string().default("active"),
        parameterKey: z.string(),
        parameterValue: z.string(),
        dataType: z.string().default("xsd:string"),
        confirm: z.boolean().optional().describe("Must be true to proceed."),
      },
    },
    writeHandler(
      ({ artifactId, version, parameterKey, parameterValue, dataType }) =>
        cpiRequest(
          "PUT",
          `/IntegrationDesigntimeArtifacts(Id=${odataString(artifactId)},Version=${odataString(version)})/$links/Configurations(${odataString(parameterKey)})`,
          { body: { ParameterValue: parameterValue, DataType: dataType } }
        ),
      { action: ({ parameterKey, artifactId }) => `update parameter '${parameterKey}' on flow '${artifactId}'` }
    )
  );

  // --- Custom tags / resources -------------------------------------------
  server.registerTool(
    "get_flow_resources",
    {
      title: "Get Flow Resources",
      description: "List the resources (scripts, XSDs, WSDLs, mappings) inside an integration flow.",
      inputSchema: { artifactId: z.string(), version: z.string().default("active") },
    },
    readHandler(({ artifactId, version }) =>
      cpiGet(
        `/IntegrationDesigntimeArtifacts(Id=${odataString(artifactId)},Version=${odataString(version)})/Resources`
      )
    )
  );

  // --- Create integration flow -------------------------------------------
  server.registerTool(
    "create_integration_flow",
    {
      title: "Create Integration Flow",
      description:
        "Create a new (empty) integration flow in a package — a default flow at version 1.0.0 that " +
        "you then edit in the Integration Suite web editor. Requires ALLOW_WRITE.",
      inputSchema: {
        packageId: z.string(),
        id: z.string().describe("Technical Id (no spaces)."),
        name: z.string(),
        description: z.string().optional(),
        confirm: z.boolean().optional().describe("Must be true to proceed."),
      },
    },
    writeHandler(
      ({ packageId, id, name, description }) =>
        cpiRequest("POST", "/IntegrationDesigntimeArtifacts", {
          body: { Name: name, Id: id, PackageId: packageId, Description: description || "" },
        }),
      { action: ({ id, packageId }) => `create integration flow '${id}' in package '${packageId}'` }
    )
  );

  // --- Save integration flow as a version --------------------------------
  server.registerTool(
    "save_integration_flow_as_version",
    {
      title: "Save Integration Flow as Version",
      description:
        "Save the current draft ('active') of an integration flow as a new version, with an optional " +
        "version comment. Requires ALLOW_WRITE. (The comment is applied to the artifact before the " +
        "version is saved, since the SaveAsVersion API doesn't take one directly.)",
      inputSchema: {
        artifactId: z.string(),
        version: z.string().describe("New version to save, e.g. '1.0.1'."),
        comment: z.string().optional().describe("Version comment / note."),
        confirm: z.boolean().optional().describe("Must be true to proceed."),
      },
    },
    writeHandler(
      async ({ artifactId, version, comment }) => {
        let commentApplied = false;
        let commentNote = null;
        if (comment) {
          // Setting the comment requires a PUT that includes the artifact Name, so fetch it first.
          // Best-effort: never let the comment step block the version save.
          try {
            const art = await cpiGet(
              `/IntegrationDesigntimeArtifacts(Id=${odataString(artifactId)},Version=${odataString("active")})`
            );
            await cpiRequest(
              "PUT",
              `/IntegrationDesigntimeArtifacts(Id=${odataString(artifactId)},Version=${odataString("active")})`,
              { body: { Name: art.Name, Comment: comment } }
            );
            commentApplied = true;
          } catch (e) {
            commentNote = `Comment could not be applied (${e.message}); version was still saved.`;
          }
        }
        const result = await cpiInvoke("IntegrationDesigntimeArtifactSaveAsVersion", {
          Id: artifactId,
          SaveAsVersion: version,
        });
        return { artifactId, savedVersion: version, comment: comment || null, commentApplied, commentNote, result };
      },
      { action: ({ artifactId, version }) => `save flow '${artifactId}' as version ${version}` }
    )
  );
}
