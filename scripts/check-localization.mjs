import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "c-insight-l10n-"));
const executable = resolve(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vscode-l10n-dev.cmd" : "vscode-l10n-dev",
);

try {
  const result = spawnSync(
    executable,
    ["export", "-o", temporaryDirectory, "./src"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }

  const generated = readCatalog(
    join(temporaryDirectory, "bundle.l10n.json"),
  );
  const committed = readCatalog("l10n/bundle.l10n.json");
  const chinese = readCatalog("l10n/bundle.l10n.zh-cn.json");
  const generatedKeys = Object.keys(generated).sort();
  const committedKeys = Object.keys(committed).sort();
  const chineseKeys = Object.keys(chinese).sort();

  assertEqualKeys(
    generatedKeys,
    committedKeys,
    "Run npm run l10n:export and commit l10n/bundle.l10n.json.",
  );
  assertEqualKeys(
    committedKeys,
    chineseKeys,
    "Update l10n/bundle.l10n.zh-cn.json for every runtime message.",
  );
  for (const key of generatedKeys) {
    if (generated[key] !== committed[key]) {
      fail(`Default localization value differs for: ${key}`);
    }
  }
  console.log(
    `Localization catalogs are synchronized (${generatedKeys.length} runtime messages).`,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function readCatalog(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertEqualKeys(expected, actual, guidance) {
  const missing = expected.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !expected.includes(key));
  if (missing.length || extra.length) {
    fail(
      [
        guidance,
        missing.length ? `Missing: ${missing.join(", ")}` : undefined,
        extra.length ? `Extra: ${extra.join(", ")}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
