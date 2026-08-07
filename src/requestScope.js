// Per-request scope propagation from the HTTP auth layer down into tool handlers.
//
// The MCP SDK only ever calls a tool handler with (args) — it has no notion of "the
// HTTP request this call arrived on". AsyncLocalStorage bridges that gap: the /mcp
// route in index.js opens a scope for the caller's JWT scopes at the top of each
// request, and readHandler/writeHandler in domains/helpers.js read it back out —
// regardless of how deep inside the SDK's dispatch the tool function is actually
// invoked. No domain file needs to know this exists.
import { AsyncLocalStorage } from "node:async_hooks";

export const scopeStorage = new AsyncLocalStorage();

/**
 * The current caller's XSUAA scopes (e.g. ["mcp.read", "mcp.write"]), or null when
 * there is no per-request auth context at all — the stdio transport (a local
 * subprocess implicitly trusted by whoever launched it, with no role boundary).
 */
export function currentScopes() {
  const store = scopeStorage.getStore();
  return store ? store.scopes : null;
}

/**
 * True if the current caller may use a tool gated behind `scope`.
 * Always true outside a request context (stdio) — unchanged behavior there.
 */
export function hasScope(scope) {
  const scopes = currentScopes();
  if (scopes === null) return true;
  return scopes.includes(scope);
}
