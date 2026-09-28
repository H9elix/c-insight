import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const lockPath = path.join(repositoryRoot, "package-lock.json");
const outputPath = path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md");
const write = process.argv.includes("--write");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));

const dependencies = Object.entries(lock.packages)
  .filter(
    ([location, metadata]) =>
      location.startsWith("node_modules/") &&
      metadata.dev !== true &&
      metadata.link !== true,
  )
  .map(([location, metadata]) => dependencyNotice(location, metadata))
  .sort((left, right) => left.name.localeCompare(right.name));

const groupedLicenses = new Map();
for (const dependency of dependencies) {
  const group = groupedLicenses.get(dependency.licenseText) ?? [];
  group.push(`${dependency.name}@${dependency.version}`);
  groupedLicenses.set(dependency.licenseText, group);
}

const sections = [
  "# Third-Party Notices",
  "",
  "This file is generated from the production dependency tree by `npm run third-party:generate`. C Insight itself is licensed under the MIT License in `LICENSE`.",
  "",
  "| Package | Declared license |",
  "| --- | --- |",
  ...dependencies.map(
    (dependency) =>
      `| \`${dependency.name}@${dependency.version}\` | ${dependency.license} |`,
  ),
  "",
  "## License texts",
  "",
];

for (const [licenseText, packages] of [...groupedLicenses.entries()].sort(
  ([, left], [, right]) => left[0].localeCompare(right[0]),
)) {
  sections.push(`### ${packages.join(", ")}`, "", "```text", licenseText, "```", "");
}

const generated = `${sections.join("\n").replace(/\n+$/, "")}\n`;
if (write) {
  writeFileSync(outputPath, generated);
} else if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== generated) {
  console.error(
    "THIRD_PARTY_NOTICES.md is stale. Run npm run third-party:generate.",
  );
  process.exitCode = 1;
}

function dependencyNotice(location, metadata) {
  const directory = path.join(repositoryRoot, location);
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const licenseFile = readdirSync(directory)
    .filter((entry) => /^(?:licen[cs]e|copying)(?:\..*)?$/i.test(entry))
    .sort()[0];
  if (!licenseFile) {
    throw new Error(`No license file found for ${manifest.name}@${manifest.version}`);
  }
  return {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license ?? metadata.license ?? "Unspecified",
    licenseText: readFileSync(path.join(directory, licenseFile), "utf8")
      .replaceAll("\r\n", "\n")
      .trim(),
  };
}
