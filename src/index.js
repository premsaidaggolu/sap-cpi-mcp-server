// Entry point for the SAP CPI monitoring MCP server.
// Supports two transports selected via MCP_TRANSPORT:
//   - "stdio" (default) : for local use with Claude Desktop / Claude Code
//   - "http"            : Streamable HTTP, for deployment to Cloud Foundry / any host
//
// On Cloud Foundry, PORT is injected by the platform and MCP_TRANSPORT should be "http".

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerTools } from "./tools.js";
import { authMiddleware } from "./auth.js";

// Best-effort: load a local .env (project root) so stdio runs pick up credentials
// without needing them duplicated into the MCP client config. Existing env vars win.
try {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
} catch {
  // No .env file — rely on real environment variables (e.g. on Cloud Foundry).
}

const SERVER_INFO = { name: "sap-cpi-mcp-server", version: "1.0.0" };

function buildServer() {
  const server = new McpServer(SERVER_INFO);
  registerTools(server);
  return server;
}

async function runStdio() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio servers must not write to stdout; log to stderr.
  console.error("[sap-cpi-mcp-server] running on stdio transport");
}

async function runHttp() {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Simple health endpoint for Cloud Foundry.
  app.get("/health", (_req, res) => res.json({ status: "ok", server: SERVER_INFO }));

  // Authentication: OAuth 2.0 (XSUAA JWT) when bound, else static token, else open.
  app.use("/mcp", authMiddleware());

  // Stateless Streamable HTTP: a fresh transport + server per request.
  app.post("/mcp", async (req, res) => {
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        // Return a single application/json response instead of an SSE stream.
        // Friendlier for Postman/curl; MCP SDK clients still handle it fine.
        enableJsonResponse: true,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[sap-cpi-mcp-server] request error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // GET/DELETE on /mcp are not used in stateless mode.
  const methodNotAllowed = (_req, res) =>
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[sap-cpi-mcp-server] HTTP transport listening on port ${port} at /mcp`);
  });
}

const transport = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();
if (transport === "http") {
  runHttp().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else {
  runStdio().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
