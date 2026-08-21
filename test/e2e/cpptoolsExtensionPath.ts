import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

const cpptoolsDirectory = /^ms-vscode\.cpptools-\d+(?:\.\d+){2}(?:-[A-Za-z0-9.]+)*$/;

export function resolveCpptoolsExtensionPath(
  explicitPath = process.env.C_INSIGHT_CPPTOOLS_EXTENSION_PATH,
  extensionsDirectory = path.join(homedir(), ".vscode-server", "extensions"),
): string {
  if (explicitPath) {
    return explicitPath;
  }
  const candidates = readdirSync(extensionsDirectory, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && cpptoolsDirectory.test(entry.name),
    )
    .map((entry) => path.join(extensionsDirectory, entry.name))
    .filter((candidate) => existsSync(path.join(candidate, "package.json")))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
  const latest = candidates.at(-1);
  if (!latest) {
    throw new Error(
      `No Microsoft C/C++ extension was found under ${extensionsDirectory}. ` +
        "Set C_INSIGHT_CPPTOOLS_EXTENSION_PATH to its installation directory.",
    );
  }
  return latest;
}
