// Runtime & deployment domain: deploy/undeploy, deployed artifacts, build status,
// service endpoints.
import { z } from "zod";
import { cpiGet, cpiRequest, cpiInvoke, odataString } from "../cpiClient.js";
import { readHandler, writeHandler, registerScopedTool } from "./helpers.js";

// Map artifact type -> deploy function import name.
const DEPLOY_FN = {
  integrationFlow: "DeployIntegrationDesigntimeArtifact",
  messageMapping: "DeployMessageMappingDesigntimeArtifact",
  valueMapping: "DeployValueMappingDesigntimeArtifact",
  scriptCollection: "DeployScriptCollectionDesigntimeArtifact",
  integrationAdapter: "DeployIntegrationAdapterDesigntimeArtifact",
};

export function registerRuntimeTools(server) {
  registerScopedTool(server,
    "list_deployed_artifacts",
    {
      title: "List Deployed Runtime Artifacts",
      description:
        "List all deployed runtime artifacts and their status (STARTED, ERROR, STARTING, etc.).",
      inputSchema: { top: z.number().int().min(1).max(500).default(100) },
    },
    readHandler(({ top }) => cpiGet("/IntegrationRuntimeArtifacts", { $top: top }))
  );

  registerScopedTool(server,
    "get_deployed_artifact_status",
    {
      title: "Get Deployed Artifact Status",
      description: "Get the deployment status of one runtime artifact, plus error details if failed.",
      inputSchema: { artifactId: z.string(), includeErrorDetails: z.boolean().default(true) },
    },
    readHandler(async ({ artifactId, includeErrorDetails }) => {
      const status = await cpiGet(`/IntegrationRuntimeArtifacts(${odataString(artifactId)})`);
      let errorDetails = null;
      if (includeErrorDetails) {
        try {
          errorDetails = await cpiGet(
            `/IntegrationRuntimeArtifacts(${odataString(artifactId)})/ErrorInformation/$value`,
            {},
            { raw: true }
          );
        } catch {
          /* healthy artifact — no error info */
        }
      }
      return { status, errorDetails };
    })
  );

  registerScopedTool(server,
    "deploy_artifact",
    {
      title: "Deploy Artifact",
      description:
        "Deploy a design-time artifact to the runtime. Choose the artifact type. Requires ALLOW_WRITE. " +
        "Deployment is asynchronous — check status with get_deployed_artifact_status or get_build_and_deploy_status.",
      inputSchema: {
        artifactId: z.string(),
        version: z.string().default("active"),
        type: z
          .enum(["integrationFlow", "messageMapping", "valueMapping", "scriptCollection", "integrationAdapter"])
          .default("integrationFlow"),
        confirm: z.boolean().optional().describe("Must be true to proceed."),
      },
    },
    writeHandler(
      async ({ artifactId, version, type }) => {
        const fn = DEPLOY_FN[type];
        const result = await cpiInvoke(fn, { Id: artifactId, Version: version });
        return { requested: { artifactId, version, type, function: fn }, result };
      },
      { action: ({ artifactId, type }) => `deploy ${type} '${artifactId}' to the runtime` }
    )
  );

  registerScopedTool(server,
    "undeploy_artifact",
    {
      title: "Undeploy Artifact",
      description:
        "Undeploy (remove from runtime) a deployed artifact. Stops it processing messages. " +
        "Requires ALLOW_WRITE and confirm=true.",
      inputSchema: { artifactId: z.string(), confirm: z.boolean().optional() },
    },
    writeHandler(
      ({ artifactId }) => cpiRequest("DELETE", `/IntegrationRuntimeArtifacts(${odataString(artifactId)})`),
      { destructive: ({ artifactId }) => `undeploy runtime artifact '${artifactId}'` }
    )
  );

  registerScopedTool(server,
    "get_build_and_deploy_status",
    {
      title: "Get Build & Deploy Status",
      description:
        "Check the asynchronous build/deploy task status for a deployment (returned as a task id).",
      inputSchema: { taskId: z.string().describe("The deploy task id returned by deploy_artifact.") },
    },
    readHandler(({ taskId }) => cpiGet(`/BuildAndDeployStatus(TaskId=${odataString(taskId)})`))
  );

  registerScopedTool(server,
    "list_service_endpoints",
    {
      title: "List Service Endpoints",
      description:
        "List the runtime service endpoints (URLs) exposed by deployed integration flows (HTTP, SOAP, OData, etc.).",
      inputSchema: { top: z.number().int().min(1).max(500).default(100) },
    },
    readHandler(({ top }) => cpiGet("/ServiceEndpoints", { $top: top, $expand: "EntryPoints" }))
  );
}
