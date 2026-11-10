import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export const supportedClientVersion = "10.1.0";
const supportedFiles = new Set([
  "lib/common/utils/globPattern.js",
  "lib/common/fileOperations.js",
]);

/** Both consumers use makeRe() only to reject patterns with no parsed alternatives. */
export function adaptLanguageClientMatcher(source, file, version) {
  if (version !== supportedClientVersion || !supportedFiles.has(file)) {
    throw new Error(`Review the minimatch compatibility patch for vscode-languageclient ${version}: ${file}`);
  }
  const previous = "if (!matcher.makeRe())";
  if (source.split(previous).length !== 2) {
    throw new Error(`Expected exactly one legacy matcher check in ${file}`);
  }
  return source.replace(previous, "if (matcher.set.length === 0)");
}

/** Patch only the bundled client, without modifying node_modules or global prototypes. */
export function languageClientMinimatchCompat(repositoryRoot) {
  return {
    name: "languageclient-minimatch-compat",
    setup(build) {
      const clientRoot = resolve(repositoryRoot, "node_modules/vscode-languageclient");
      const patchedFiles = new Set();
      build.onLoad({ filter: /[\\/]vscode-languageclient[\\/]lib[\\/]common[\\/](?:utils[\\/]globPattern|fileOperations)\.js$/ }, async args => {
        const file = relative(clientRoot, args.path).replaceAll("\\", "/");
        const manifest = JSON.parse(await readFile(resolve(clientRoot, "package.json"), "utf8"));
        const source = await readFile(args.path, "utf8");
        const contents = adaptLanguageClientMatcher(source, file, manifest.version);
        patchedFiles.add(file);
        return { contents, loader: "js" };
      });
      build.onEnd(result => {
        if (result.errors.length === 0 && patchedFiles.size !== supportedFiles.size) {
          return { errors: [{ text: "Expected both language-client minimatch compatibility patches in the extension bundle." }] };
        }
        return undefined;
      });
    },
  };
}
