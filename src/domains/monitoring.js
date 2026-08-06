// Message monitoring domain: Message Processing Logs (MPL), message store, traces.
import { z } from "zod";
import { cpiGet, cpiInvoke, odataString, odataDateTime } from "../cpiClient.js";
import { readHandler, writeHandler } from "./helpers.js";

export function registerMonitoringTools(server) {
  server.registerTool(
    "search_message_processing_logs",
    {
      title: "Search Message Processing Logs (MPL)",
      description:
        "Search SAP CPI Message Processing Logs. Filter by status (COMPLETED, FAILED, PROCESSING, " +
        "RETRY, ESCALATED, DISCARDED), integration flow name, and time window. Most recent first.",
      inputSchema: {
        status: z
          .enum(["COMPLETED", "FAILED", "PROCESSING", "RETRY", "ESCALATED", "DISCARDED", "ABANDONED"])
          .optional(),
        integrationFlowName: z.string().optional(),
        fromTime: z.string().optional().describe("ISO 8601; LogEnd greater than this."),
        toTime: z.string().optional().describe("ISO 8601; LogEnd less than this."),
        top: z.number().int().min(1).max(500).default(50),
      },
    },
    readHandler(async ({ status, integrationFlowName, fromTime, toTime, top }) => {
      const filters = [];
      if (status) filters.push(`Status eq ${odataString(status)}`);
      if (integrationFlowName) filters.push(`IntegrationFlowName eq ${odataString(integrationFlowName)}`);
      if (fromTime) filters.push(`LogEnd gt ${odataDateTime(fromTime)}`);
      if (toTime) filters.push(`LogEnd lt ${odataDateTime(toTime)}`);
      const query = { $top: top, $orderby: "LogEnd desc" };
      if (filters.length) query.$filter = filters.join(" and ");
      return cpiGet("/MessageProcessingLogs", query);
    })
  );

  server.registerTool(
    "get_mpl_details",
    {
      title: "Get MPL Details",
      description: "Get the full Message Processing Log entry for a specific MessageGuid.",
      inputSchema: { messageGuid: z.string() },
    },
    readHandler(({ messageGuid }) =>
      cpiGet(`/MessageProcessingLogs(${odataString(messageGuid)})`)
    )
  );

  server.registerTool(
    "get_mpl_error_information",
    {
      title: "Get MPL Error Information",
      description: "Retrieve the detailed error/exception text for a failed message.",
      inputSchema: { messageGuid: z.string() },
    },
    readHandler(async ({ messageGuid }) => ({
      messageGuid,
      errorInformation: await cpiGet(
        `/MessageProcessingLogs(${odataString(messageGuid)})/ErrorInformation/$value`,
        {},
        { raw: true }
      ),
    }))
  );

  server.registerTool(
    "get_mpl_custom_header_properties",
    {
      title: "Get MPL Custom Header Properties",
      description: "Get custom header properties (business keys, custom status) for a message.",
      inputSchema: { messageGuid: z.string() },
    },
    readHandler(({ messageGuid }) =>
      cpiGet(`/MessageProcessingLogs(${odataString(messageGuid)})/CustomHeaderProperties`)
    )
  );

  server.registerTool(
    "get_mpl_run_steps",
    {
      title: "Get MPL Run Steps",
      description:
        "Get the individual run steps for a message (requires trace/step logging enabled on the flow).",
      inputSchema: { messageGuid: z.string() },
    },
    readHandler(({ messageGuid }) =>
      cpiGet(`/MessageProcessingLogs(${odataString(messageGuid)})/Runs`)
    )
  );

  server.registerTool(
    "get_message_store_entries",
    {
      title: "Get Message Store Entries",
      description:
        "Get persisted message store entries (payloads persisted via the 'Persist' step) for a message.",
      inputSchema: { messageGuid: z.string() },
    },
    readHandler(({ messageGuid }) =>
      cpiGet(`/MessageProcessingLogs(${odataString(messageGuid)})/MessageStoreEntries`)
    )
  );

  server.registerTool(
    "get_failure_summary",
    {
      title: "Get Failure Summary",
      description:
        "Aggregate failed/escalated messages over a recent window, grouped by integration flow.",
      inputSchema: {
        hoursBack: z.number().int().min(1).max(720).default(24),
        top: z.number().int().min(1).max(1000).default(500),
      },
    },
    readHandler(async ({ hoursBack, top }) => {
      const from = new Date(Date.now() - hoursBack * 3600_000).toISOString();
      const filter = `(Status eq 'FAILED' or Status eq 'ESCALATED') and LogEnd gt ${odataDateTime(from)}`;
      const logs = await cpiGet("/MessageProcessingLogs", {
        $filter: filter,
        $top: top,
        $orderby: "LogEnd desc",
      });
      const list = Array.isArray(logs) ? logs : [];
      const byFlow = {};
      for (const l of list) {
        const key = l.IntegrationFlowName || "(unknown)";
        byFlow[key] = (byFlow[key] || 0) + 1;
      }
      const summary = Object.entries(byFlow)
        .map(([flow, count]) => ({ flow, count }))
        .sort((a, b) => b.count - a.count);
      return { windowHours: hoursBack, from, totalFailures: list.length, byIntegrationFlow: summary };
    })
  );

  server.registerTool(
    "cancel_message_processing_log",
    {
      title: "Cancel Message Processing Log",
      description:
        "Cancel a currently processing/retrying message (e.g. a stuck JMS or scheduled message). " +
        "Requires ALLOW_WRITE and confirm=true.",
      inputSchema: {
        messageGuid: z.string(),
        confirm: z.boolean().optional().describe("Must be true to actually cancel."),
      },
    },
    writeHandler(({ messageGuid }) => cpiInvoke("CancelMessageProcessingLog", { MessageGuid: messageGuid }), {
      destructive: ({ messageGuid }) => `cancel message ${messageGuid}`,
    })
  );
}
