// HTTP authentication for the /mcp endpoint.
//
// Priority:
//   1. If an XSUAA service is bound (VCAP_SERVICES.xsuaa) OR AUTH_MODE=oauth -> require a valid
//      OAuth 2.0 JWT issued by XSUAA (signature verified against XSUAA's JWKS, audience checked).
//   2. Else if MCP_AUTH_TOKEN is set -> require that static bearer token (dev/fallback).
//   3. Else -> open (no auth).
import { createRemoteJWKSet, jwtVerify } from "jose";

function getXsuaaCredentials() {
  try {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || "{}");
    const arr = vcap.xsuaa || vcap.XSUAA;
    if (Array.isArray(arr) && arr[0] && arr[0].credentials) return arr[0].credentials;
  } catch {
    /* ignore */
  }
  // Allow explicit configuration without a CF binding.
  if (process.env.XSUAA_URL && process.env.XSUAA_CLIENTID) {
    return { url: process.env.XSUAA_URL, clientid: process.env.XSUAA_CLIENTID };
  }
  return null;
}

let jwksSet = null;
let jwksForUrl = null;
function getJwks(uaaUrl) {
  if (!jwksSet || jwksForUrl !== uaaUrl) {
    jwksSet = createRemoteJWKSet(new URL(`${uaaUrl.replace(/\/$/, "")}/token_keys`));
    jwksForUrl = uaaUrl;
  }
  return jwksSet;
}

function audienceMatches(payload, clientid) {
  if (!clientid) return true;
  if (payload.azp === clientid || payload.client_id === clientid) return true;
  const aud = payload.aud;
  if (Array.isArray(aud)) return aud.includes(clientid);
  return aud === clientid;
}

/**
 * Express middleware enforcing the configured auth mode.
 */
export function authMiddleware() {
  const xsuaa = getXsuaaCredentials();
  const staticToken = process.env.MCP_AUTH_TOKEN;
  const oauthMode = xsuaa && String(process.env.AUTH_MODE || "oauth").toLowerCase() !== "off";

  if (oauthMode) {
    console.log("[auth] OAuth 2.0 (XSUAA) mode enabled — JWT required.");
  } else if (staticToken) {
    console.log("[auth] Static bearer-token mode enabled.");
  } else {
    console.warn("[auth] WARNING: no authentication configured — endpoint is OPEN.");
  }

  return async (req, res, next) => {
    const authz = req.headers["authorization"] || "";
    const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : null;

    if (oauthMode) {
      if (!bearer) return res.status(401).json({ error: "Missing bearer token" });
      try {
        const { payload } = await jwtVerify(bearer, getJwks(xsuaa.url));
        if (!audienceMatches(payload, xsuaa.clientid)) {
          return res.status(401).json({ error: "Token audience mismatch" });
        }
        return next();
      } catch (err) {
        return res.status(401).json({ error: "Invalid token", detail: err.message });
      }
    }

    if (staticToken) {
      if (bearer === staticToken) return next();
      return res.status(401).json({ error: "Unauthorized" });
    }

    return next();
  };
}
