// Shared helpers for tool handlers.
import { assertWriteAllowed, maskDeep, maskString } from "../cpiClient.js";
import { hasScope } from "../requestScope.js";

function permissionDenied(scope) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          `Permission denied: this tool requires the '${scope}' scope, which your session's ` +
          `role does not grant. Ask an admin to assign the BTP role collection that includes it.`,
      },
    ],
  };
}

export function jsonResult(data) {
  const masked = maskDeep(data);
  return {
    content: [
      { type: "text", text: typeof masked === "string" ? masked : JSON.stringify(masked, null, 2) },
    ],
  };
}

export function errorResult(err) {
  const message = maskString(err.message || String(err));
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}

/**
 * Wrap a read-only handler with standard error handling.
 * Requires the 'mcp.read' scope — granted to every role (Support, Developer, Architect).
 * The returned function carries .requiredScope so registerScopedTool (below) can decide
 * whether to register the tool at all for the current caller, not just gate the call.
 */
export function readHandler(fn) {
  const wrapped = async (args) => {
    if (!hasScope("mcp.read")) return permissionDenied("mcp.read");
    try {
      return jsonResult(await fn(args));
    } catch (err) {
      return errorResult(err);
    }
  };
  wrapped.requiredScope = "mcp.read";
  return wrapped;
}

/**
 * Wrap a write handler: enforce role + ALLOW_WRITE, then require an explicit confirmation.
 * EVERY write action asks "are you sure?" and only proceeds when args.confirm === true.
 *
 * Required scope: 'mcp.write' (Developer, Architect) by default; 'mcp.delete' (Architect
 * only) when opts.destructive is set — a destructive action is exactly the kind of thing
 * the delete tier exists to gate. Pass opts.scope to override this inference directly,
 * which the generic escape-hatch tools (cpi_write, cpi_invoke_function) use to force
 * 'mcp.delete': they can reach operations no curated tool exposes, including deletes.
 * @param {Object} [opts]
 * @param {(args:any)=>string} [opts.action]  Human description of the action (used in the prompt).
 * @param {(args:any)=>string|null} [opts.destructive]  Legacy alias for opts.action; if it returns
 *   null the confirm gate is skipped for that call. Its presence alone requires 'mcp.delete'.
 * @param {string} [opts.scope]  Explicit required scope, overriding the action/destructive inference.
 */
export function writeHandler(fn, opts = {}) {
  const requiredScope = opts.scope || (opts.destructive ? "mcp.delete" : "mcp.write");
  const wrapped = async (args) => {
    if (!hasScope(requiredScope)) return permissionDenied(requiredScope);
    try {
      assertWriteAllowed();

      // Determine the action description and whether confirmation is required.
      let describe = null;
      let requireConfirm = true;
      if (opts.action) {
        describe = opts.action(args);
      } else if (opts.destructive) {
        describe = opts.destructive(args);
        requireConfirm = describe != null; // destructive() may opt out by returning null
      } else {
        describe = "perform this write operation";
      }

      if (requireConfirm && args.confirm !== true) {
        return {
          content: [
            {
              type: "text",
              text:
                `⚠️ Are you sure you want to ${describe}?\n` +
                `This will change your SAP CPI tenant. No changes have been made yet.\n` +
                `To proceed, run this tool again with confirm=true.`,
            },
          ],
        };
      }
      return jsonResult(await fn(args));
    } catch (err) {
      return errorResult(err);
    }
  };
  wrapped.requiredScope = requiredScope;
  return wrapped;
}

/**
 * Register a tool only if the current caller's scope (see requestScope.js) satisfies
 * `handler.requiredScope`, as set by readHandler/writeHandler above. Outside a request
 * context (stdio transport) hasScope() is always true, so this registers everything,
 * unchanged from before RBAC existed.
 *
 * This is what actually keeps a tool out of tools/list for a role that can't use it —
 * the scope check inside readHandler/writeHandler only stops the tool from *running*
 * if called anyway (defense in depth), it doesn't hide it from the tool list on its own.
 */
export function registerScopedTool(server, name, config, handler) {
  if (!hasScope(handler.requiredScope)) return;
  server.registerTool(name, config, handler);
}
