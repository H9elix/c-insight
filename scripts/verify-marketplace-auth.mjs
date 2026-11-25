import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execute = promisify(execFile);
export const marketplaceIdentity = Object.freeze({
  publisher: "H9elix",
  repository: "H9elix/c-insight",
  workflow: ".github/workflows/marketplace-publish.yml",
  ref: "refs/heads/main",
});

export function validateAuthenticationContext(environment) {
  const expected = {GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: marketplaceIdentity.repository, GITHUB_REF: marketplaceIdentity.ref,
    GITHUB_WORKFLOW_REF: `${marketplaceIdentity.repository}/${marketplaceIdentity.workflow}@${marketplaceIdentity.ref}`};
  for (const [key, value] of Object.entries(expected)) {
    if (environment[key] !== value) throw new Error(`Authentication must run in the trusted GitHub Actions context (${key} mismatch).`);
  }
  if (!environment.ACTIONS_ID_TOKEN_REQUEST_URL || !environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error("GitHub OIDC is unavailable. The authentication job requires id-token: write.");
  }
}

export function assertCompatibleVsceVersion(version) {
  if (version !== "4.1.0") throw new Error("Review the read-only authentication adapter before changing @vscode/vsce 4.1.0.");
}

async function boundedRequest(url, options) {
  const response = await fetch(url, {...options, redirect: "error", signal: AbortSignal.timeout(20_000)});
  return {statusCode: response.status, statusMessage: response.statusText, readBody: () => response.text()};
}

// vsce's public CLI supports --oidc only on publish. Reuse its pinned credential
// exchange, then invoke only its read-only verify-pat command with that credential.
export async function getTrustedCredential(environment, request = boundedRequest) {
  assertCompatibleVsceVersion(require("@vscode/vsce/package.json").version);
  const {getOIDCCredential} = require("@vscode/vsce/out/oidc.js");
  return getOIDCCredential(marketplaceIdentity.publisher, {environment, request});
}

export function credentialVerificationInvocation(credential, environment) {
  const childEnvironment = {...environment, VSCE_PAT: credential};
  // These GitHub bearer credentials are needed only by the exchange in this process.
  delete childEnvironment.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  delete childEnvironment.ACTIONS_ID_TOKEN_REQUEST_URL;
  return {file: process.execPath,
    args: [resolve(dirname(require.resolve("@vscode/vsce/package.json")), "vsce"), "verify-pat", marketplaceIdentity.publisher],
    options: {env: childEnvironment, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024}};
}

async function verifyCredential(credential, environment) {
  const invocation = credentialVerificationInvocation(credential, environment);
  // Capture tool output: neither SDK error bodies nor child output enter Actions logs.
  await execute(invocation.file, invocation.args, invocation.options);
}

export function githubMaskCommand(value) {
  return `::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;
}

export async function verifyMarketplaceAuthentication({environment = process.env, getCredential = getTrustedCredential,
  verify = verifyCredential, log = console.log, mask = value => console.log(githubMaskCommand(value))} = {}) {
  validateAuthenticationContext(environment);
  let credential;
  try {
    credential = await getCredential(environment);
    if (typeof credential !== "string" || !credential) throw new Error("Empty credential");
  } catch (error) {
    const status = /(?:GitHub Actions OIDC token request|Marketplace OIDC token exchange) failed with ([1-5][0-9]{2})\b/.exec(error instanceof Error ? error.message : "")?.[1];
    throw new Error(`Trusted credential exchange failed${status ? ` (HTTP ${status})` : ""}. Check the Marketplace policy, repository/workflow fields, job permissions and vsce compatibility.`);
  }
  mask(credential);
  try { await verify(credential, environment); }
  catch { throw new Error("Marketplace publisher-access verification failed. No extension was uploaded; review the H9elix policy and publisher access."); }
  const message = "Trusted Publishing authentication and publisher access verified for H9elix. No extension was uploaded.";
  log(message);
  if (environment.GITHUB_STEP_SUMMARY) await appendFile(environment.GITHUB_STEP_SUMMARY, `## Marketplace authentication\n\n${message}\n`);
  return {publisher: marketplaceIdentity.publisher, authenticated: true, publisherAccess: true, published: false};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await verifyMarketplaceAuthentication(); }
  catch (error) { console.error(error instanceof Error ? error.message : "Marketplace authentication failed."); process.exitCode = 1; }
}
