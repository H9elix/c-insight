import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ClangdInstallation {
  command: string;
  version: string;
  major: number;
}

export async function locateClangd(
  configuredPath: string,
): Promise<ClangdInstallation> {
  if (configuredPath) {
    await access(configuredPath);
    return inspectClangd(configuredPath);
  }

  const candidates =
    process.platform === "win32"
      ? ["clangd-22.exe", "clangd-21.exe", "clangd-20.exe", "clangd.exe"]
      : ["clangd-22", "clangd-21", "clangd-20", "clangd"];
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      return await inspectClangd(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${String(error)}`);
    }
  }
  throw new Error(`No usable clangd found. ${errors.join("; ")}`);
}

async function inspectClangd(command: string): Promise<ClangdInstallation> {
  const { stdout, stderr } = await execFileAsync(command, ["--version"], {
    timeout: 5_000,
    windowsHide: true,
  });
  const version = `${stdout}${stderr}`.trim();
  const match = /\bversion\s+(\d+)(?:\.\d+)*/i.exec(version);
  if (!match) {
    throw new Error(`Could not parse version output from ${command}: ${version}`);
  }
  return {
    command,
    version: version.split(/\r?\n/, 1)[0],
    major: Number(match[1]),
  };
}
