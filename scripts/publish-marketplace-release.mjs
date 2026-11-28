import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { credentialVerificationInvocation, getTrustedCredential, githubMaskCommand, marketplaceIdentity } from "./verify-marketplace-auth.mjs";
import { packageName, releaseTargets, repositoryRoot } from "./release-targets.mjs";
import { verifyReleaseAssets } from "./verify-release-assets.mjs";

const execute = promisify(execFile);

export function validatePublicationContext(environment, event, manifest, taggedSha) {
  const expected = {GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_run", GITHUB_REPOSITORY: marketplaceIdentity.repository,
    GITHUB_REF: marketplaceIdentity.ref,
    GITHUB_WORKFLOW_REF: `${marketplaceIdentity.repository}/${marketplaceIdentity.workflow}@${marketplaceIdentity.ref}`};
  for (const [key, value] of Object.entries(expected)) assert.equal(environment[key], value, `Untrusted publishing context: ${key}`);
  assert(environment.ACTIONS_ID_TOKEN_REQUEST_URL && environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN, "Publishing requires id-token: write");
  const run = event.workflow_run;
  assert.equal(event.repository?.full_name, marketplaceIdentity.repository, "Unexpected event repository");
  assert.equal(run?.head_repository?.full_name, marketplaceIdentity.repository, "Fork runs cannot publish");
  assert.equal(run?.name, "Release", "Only the Release workflow can publish");
  assert.equal(run?.path, ".github/workflows/release.yml", "Unexpected Release workflow path");
  assert.equal(run?.event, "push", "Only a Release push run can publish");
  assert.equal(run?.status, "completed", "Release must be complete");
  assert.equal(run?.conclusion, "success", "Release must succeed");
  assert(/^[a-f0-9]{40}$/.test(taggedSha), "Invalid tagged commit");
  assert.equal(run?.head_sha, taggedSha, "Release run does not match the tagged commit");
  assert.equal(manifest.publisher, marketplaceIdentity.publisher, "Unexpected publisher");
  assert.equal(manifest.name, "c-insight", "Unexpected extension");
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "Only stable versions can publish automatically");
  return `v${manifest.version}`;
}

export function publicationAssets(release, manifest) {
  const tag = `v${manifest.version}`;
  assert.equal(release.tag_name, tag, "Release tag/version mismatch");
  assert.equal(release.draft, false, "Draft releases cannot publish");
  assert.equal(release.prerelease, false, "Prereleases cannot publish automatically");
  const names = [...releaseTargets.map(({target}) => packageName(manifest, target)), "SHA256SUMS"].sort();
  assert.deepEqual(release.assets.map(asset => asset.name).sort(), names, "Missing or unexpected Release assets");
  return names.map(name => {
    const asset = release.assets.find(asset => asset.name === name);
    assert.equal(asset.state, "uploaded", "Release asset is not ready");
    assert.equal(asset.browser_download_url, `https://github.com/${marketplaceIdentity.repository}/releases/download/${tag}/${name}`, "Unexpected asset download URL");
    return asset;
  });
}

export function publicationInvocation(credential, environment, paths) {
  const invocation = credentialVerificationInvocation(credential, environment);
  invocation.args = [invocation.args[0], "publish", "--packagePath", ...paths, "--skip-duplicate"];
  invocation.options.timeout = 12 * 60_000;
  delete invocation.options.env.GH_TOKEN;
  delete invocation.options.env.GITHUB_TOKEN;
  return invocation;
}

export async function publishVerifiedAssets({environment, paths, verify, credential = getTrustedCredential,
  publish = invocation => execute(invocation.file, invocation.args, invocation.options), mask = value => console.log(githubMaskCommand(value))}) {
  await verify(); // All bytes, target metadata, native programs and checksums precede credential access.
  let token;
  try {token = await credential(environment); assert(typeof token === "string" && token);}
  catch {throw new Error("Marketplace trusted credential exchange failed. Review the existing policy and job permissions.");}
  mask(token);
  try {await publish(publicationInvocation(token, environment, paths));}
  catch {throw new Error("Marketplace package upload failed. Verified GitHub assets remain available; rerun the failed publishing job after checking publisher access.");}
}

async function main() {
  const environment = process.env;
  assert(environment.GITHUB_EVENT_PATH, "Publishing must run inside GitHub Actions");
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "Invalid stable version");
  const event = JSON.parse(await readFile(environment.GITHUB_EVENT_PATH, "utf8"));
  const {stdout} = await execute("git", ["rev-parse", `refs/tags/v${manifest.version}^{}`], {cwd: repositoryRoot});
  const taggedSha = stdout.trim(), tag = validatePublicationContext(environment, event, manifest, taggedSha);
  await execute("git", ["merge-base", "--is-ancestor", taggedSha, "HEAD"], {cwd: repositoryRoot});
  const response = await fetch(`https://api.github.com/repos/${marketplaceIdentity.repository}/releases/tags/${tag}`, {
    headers: {Accept: "application/vnd.github+json", ...(environment.GH_TOKEN ? {Authorization: `Bearer ${environment.GH_TOKEN}`} : {})},
    redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `Cannot read published GitHub Release (HTTP ${response.status})`);
  const assets = publicationAssets(await response.json(), manifest), outDir = resolve(repositoryRoot, ".cache/marketplace", manifest.version);
  await mkdir(outDir, {recursive: true});
  for (const asset of assets) {
    const response = await fetch(asset.browser_download_url, {signal: AbortSignal.timeout(120_000)});
    assert(response.ok, `Cannot download ${asset.name} (HTTP ${response.status})`);
    await writeFile(resolve(outDir, asset.name), new Uint8Array(await response.arrayBuffer()));
  }
  const paths = releaseTargets.map(({target}) => resolve(outDir, packageName(manifest, target)));
  await publishVerifiedAssets({environment, paths, verify: () => verifyReleaseAssets({outDir})});
  const message = `Marketplace upload completed for H9elix.c-insight ${manifest.version}: seven platform packages and Universal, using verified GitHub Release assets.`;
  console.log(message);
  if (environment.GITHUB_STEP_SUMMARY) await appendFile(environment.GITHUB_STEP_SUMMARY, `## Marketplace publication\n\n${message}\n\nhttps://marketplace.visualstudio.com/items?itemName=H9elix.c-insight\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {await main();} catch (error) {console.error(error instanceof Error ? error.message : "Marketplace publication failed."); process.exitCode = 1;}
}
