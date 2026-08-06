// Shared helpers for tool handlers.
import { assertWriteAllowed, maskDeep, maskString } from "../cpiClient.js";

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
 */
export function readHandler(fn) {
  return async (args) => {
    try {
      return jsonResult(await fn(args));
    } catch (err) {
      return errorResult(err);
    }
  };
}

/**
 * Wrap a write handler: enforce ALLOW_WRITE, then require an explicit confirmation.
 * EVERY write action asks "are you sure?" and only proceeds when args.confirm === true.
 * @param {Object} [opts]
 * @param {(args:any)=>string} [opts.action]  Human description of the action (used in the prompt).
 * @param {(args:any)=>string|null} [opts.destructive]  Legacy alias for opts.action; if it returns
 *   null the confirm gate is skipped for that call.
 */
export function writeHandler(fn, opts = {}) {
  return async (args) => {
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
}
