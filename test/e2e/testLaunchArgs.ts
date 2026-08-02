import * as os from "node:os";
import * as path from "node:path";

export function isolatedTestLaunchArgs(workspace: string): string[] {
  const instance = `${process.pid}-${Date.now()}`;
  const root = path.join(os.tmpdir(), `c-insight-vscode-test-${instance}`);
  return [
    workspace,
    `--user-data-dir=${path.join(root, "user-data")}`,
    `--extensions-dir=${path.join(root, "extensions")}`,
    "--disable-extensions",
    "--disable-gpu",
    "--no-sandbox",
  ];
}
