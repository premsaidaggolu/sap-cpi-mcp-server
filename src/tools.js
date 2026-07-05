// Aggregates all tool domains and registers them on the MCP server.
import { registerMonitoringTools } from "./domains/monitoring.js";
import { registerContentTools } from "./domains/content.js";
import { registerRuntimeTools } from "./domains/runtime.js";
import { registerAdminTools } from "./domains/admin.js";
import { registerGenericTools } from "./domains/generic.js";

export function registerTools(server) {
  registerMonitoringTools(server); // MPL logs, message store, cancel
  registerContentTools(server); // packages, flows, mappings, configurations
  registerRuntimeTools(server); // deploy/undeploy, deployed artifacts, endpoints
  registerAdminTools(server); // security material, number ranges, data stores, queues, partners, logs
  registerGenericTools(server); // catalog + cpi_query / cpi_get_entity / cpi_invoke_function / cpi_write
}
