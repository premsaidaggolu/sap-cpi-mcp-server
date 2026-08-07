// "Where used" domain: search a word/string across integration flow content
// (BPMN process XML, groovy scripts, mappings, parameter files — everything
// inside a flow's package) in the design workspace.
import { z } from "zod";
import JSZip from "jszip";
import { cpiGet, odataString } from "../cpiClient.js";
import { readHandler, registerScopedTool } from "./helpers.js";

// Extensions worth searching as text. Everything else inside an iflow zip
// (icons, jars, etc.) is skipped — searching binary content as text is both
// useless and slow.
const TEXT_EXTENSIONS = [
  ".iflw", ".prop", ".propdef", ".groovy", ".js", ".java",
  ".xsl", ".xslt", ".xsd", ".wsdl", ".mmap", ".json", ".properties",
  ".txt", ".project", ".mf", ".xml",
];

function isTextFile(path) {
  const lower = path.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Search every text file inside an integration flow's zip for a word
 * (case-insensitive substring match). Returns per-file line matches.
 */
async function searchWordInFlowZip(zipBuffer, word) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const needle = word.toLowerCase();
  const matches = [];

  const entries = Object.values(zip.files).filter((f) => !f.dir && isTextFile(f.name));
  for (const entry of entries) {
    const text = await entry.async("string");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(needle)) {
        matches.push({
          file: entry.name,
          line: idx + 1,
          text: line.trim().slice(0, 300),
        });
      }
    });
  }
  return matches;
}

async function listPackages() {
  return cpiGet("/IntegrationPackages", { $top: 500, $select: "Id,Name,ShortText" });
}

async function listFlowsInPackage(packageId) {
  return cpiGet(`/IntegrationPackages(${odataString(packageId)})/IntegrationDesigntimeArtifacts`);
}

async function searchOneFlow(artifactId, version, word) {
  const buf = await cpiGet(
    `/IntegrationDesigntimeArtifacts(Id=${odataString(artifactId)},Version=${odataString(version)})/$value`,
    {},
    { binary: true }
  );
  return searchWordInFlowZip(buf, word);
}

export function registerWhereUsedTools(server) {
  registerScopedTool(server,
    "where_used",
    {
      title: "Where Used — Search a Word Across Integration Flow Content",
      description:
        "Search for a word/text across integration flow content in the design workspace (BPMN process XML, " +
        "adapter channel properties — including credential/user references, groovy scripts, mappings, and " +
        "parameter files). Wizard-style: if packageId is omitted, returns the list of packages to pick from " +
        "(plus the option to set searchAllPackages=true to search the whole tenant in one call). If a " +
        "packageId is chosen but artifactId is omitted, returns the list of integration flows in that " +
        "package (plus the option to set searchAllArtifacts=true to search every flow in that package). " +
        "Call the tool again with the missing field filled in from the returned options.",
      inputSchema: {
        word: z.string().describe("Word or text to search for (case-insensitive substring match)."),
        packageId: z.string().optional().describe("Package to search in. Omit to get the list of packages."),
        artifactId: z
          .string()
          .optional()
          .describe(
            "Specific integration flow Id to search. Omit (with searchAllArtifacts left false) to get the list of flows in the package."
          ),
        searchAllPackages: z
          .boolean()
          .default(false)
          .describe("Search every package (and every flow in each) — a full tenant-wide search in one call."),
        searchAllArtifacts: z
          .boolean()
          .default(false)
          .describe("Search every integration flow in the given package instead of picking just one."),
        version: z.string().default("active"),
      },
    },
    readHandler(async ({ word, packageId, artifactId, searchAllPackages, searchAllArtifacts, version }) => {
      // Broadest option first: search absolutely everything, tenant-wide.
      if (searchAllPackages) {
        const packages = await listPackages();
        const byPackage = [];
        let totalMatches = 0;
        let artifactsScanned = 0;

        for (const pkg of packages) {
          const flows = await listFlowsInPackage(pkg.Id);
          const flowResults = [];
          for (const f of flows) {
            artifactsScanned++;
            let matches;
            try {
              matches = await searchOneFlow(f.Id, version, word);
            } catch (e) {
              flowResults.push({ artifactId: f.Id, error: e.message });
              continue;
            }
            if (matches.length) {
              totalMatches += matches.length;
              flowResults.push({ artifactId: f.Id, matches });
            }
          }
          if (flowResults.length) byPackage.push({ packageId: pkg.Id, results: flowResults });
        }

        return {
          step: "results",
          scope: "all_packages",
          word,
          packagesScanned: packages.length,
          artifactsScanned,
          totalMatches,
          byPackage,
        };
      }

      // Step 1: no package chosen yet — list packages, with the "search everything" option.
      if (!packageId) {
        const packages = await listPackages();
        return {
          step: "select_package",
          word,
          message: `${packages.length} package(s) found. Pick one, or search everything.`,
          options: [
            "Call where_used again with the same word and one of these Ids as packageId.",
            "Or call where_used again with the same word and searchAllPackages=true to search every package in the tenant.",
          ],
          packages: packages.map((p) => ({ id: p.Id, name: p.Name, shortText: p.ShortText })),
        };
      }

      // Step 2: package chosen, but no specific flow and not searching all — list flows,
      // with the "search all artifacts in this package" option.
      if (!artifactId && !searchAllArtifacts) {
        const flows = await listFlowsInPackage(packageId);
        return {
          step: "select_artifact",
          word,
          packageId,
          message: `${flows.length} integration flow(s) in '${packageId}'. Pick one, or search all of them.`,
          options: [
            "Call where_used again with the same word and packageId, plus one of these Ids as artifactId.",
            `Or call where_used again with the same word and packageId, plus searchAllArtifacts=true to search all ${flows.length} flows in this package.`,
          ],
          integrationFlows: flows.map((f) => ({ id: f.Id, name: f.Name, version: f.Version })),
        };
      }

      // Step 3: actually search — either one flow, or every flow in the chosen package.
      const targets = artifactId ? [{ Id: artifactId }] : await listFlowsInPackage(packageId);

      const results = [];
      for (const t of targets) {
        let matches;
        try {
          matches = await searchOneFlow(t.Id, version, word);
        } catch (e) {
          results.push({ artifactId: t.Id, error: e.message });
          continue;
        }
        if (matches.length) results.push({ artifactId: t.Id, matches });
      }

      return {
        step: "results",
        scope: "package",
        word,
        packageId,
        scannedArtifacts: targets.length,
        flowsWithMatches: results.length,
        results,
      };
    })
  );
}
