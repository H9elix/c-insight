import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Locate only our bundled executable, never a private VS Code installation path. */
export function packagedRipgrep(workerPath: string): string | undefined {
  const path = join(dirname(workerPath), "ripgrep", `${process.platform}-${process.arch}`, process.platform === "win32" ? "rg.exe" : "rg");
  return existsSync(path) ? path : undefined;
}
