import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

type Environment = Record<string, string | undefined>;
interface Response { statusCode: number; statusMessage: string; readBody(): Promise<string> }
interface Authentication {
  marketplaceIdentity: {publisher: string; repository: string; workflow: string; ref: string};
  validateAuthenticationContext(environment: Environment): void;
  assertCompatibleVsceVersion(version: string): void;
  getTrustedCredential(environment: Environment, request: (url: string, options: {method: string; headers: Record<string, string>; body?: string}) => Promise<Response>): Promise<string>;
  credentialVerificationInvocation(credential: string, environment: Environment): {file: string; args: string[]; options: {env: Environment; timeout: number}};
  githubMaskCommand(value: string): string;
  verifyMarketplaceAuthentication(options: {environment: Environment; getCredential(environment: Environment): Promise<string>;
    verify(credential: string, environment: Environment): Promise<void>; log(message: string): void; mask(credential: string): void}): Promise<{publisher: string; authenticated: boolean; publisherAccess: boolean; published: boolean}>;
}
const authentication = (): Promise<Authentication> => import(pathToFileURL(resolve("scripts/verify-marketplace-auth.mjs")).href);
const environment = (): Environment => ({GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "H9elix/c-insight",
  GITHUB_REF: "refs/heads/main", GITHUB_WORKFLOW_REF: "H9elix/c-insight/.github/workflows/marketplace-publish.yml@refs/heads/main",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example.test/request?api-version=1", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-runner-credential"});

describe("Marketplace authentication without publishing", () => {
  it("allows only the configured manual main-branch identity and OIDC permissions", async () => {
    const auth = await authentication();
    auth.validateAuthenticationContext(environment());
    assert.equal(auth.marketplaceIdentity.publisher, "H9elix");
    for (const [key, value] of [["GITHUB_ACTIONS", "false"], ["GITHUB_EVENT_NAME", "push"], ["GITHUB_REPOSITORY", "fork/c-insight"],
      ["GITHUB_REF", "refs/tags/v0.24.0"], ["GITHUB_WORKFLOW_REF", "H9elix/c-insight/.github/workflows/release.yml@refs/heads/main"],
      ["ACTIONS_ID_TOKEN_REQUEST_TOKEN", ""], ["ACTIONS_ID_TOKEN_REQUEST_URL", ""]]) {
      assert.throws(() => auth.validateAuthenticationContext({...environment(), [key]: value}), /trusted GitHub Actions context|id-token: write/);
    }
    auth.assertCompatibleVsceVersion("4.0.0");
    for (const version of ["3.9.0", "4.0.1", "5.0.0"]) assert.throws(() => auth.assertCompatibleVsceVersion(version), /Review/);
  });

  it("uses the installed vsce exchange with the Marketplace audience and exact publisher", async () => {
    const auth = await authentication(), calls: string[] = [];
    const credential = await auth.getTrustedCredential(environment(), async (url, options) => {
      calls.push(url);
      let body;
      if (calls.length === 1) {
        assert.equal(options.method, "GET");
        assert.equal(new URL(url).searchParams.get("audience"), "marketplace.visualstudio.com");
        assert.equal(options.headers.Authorization, "Bearer synthetic-runner-credential");
        body = {value: "synthetic-github-identity"};
      } else {
        assert.equal(url, "https://marketplace.visualstudio.com/_apis/gallery/token");
        assert.equal(options.method, "POST");
        assert.equal(options.headers.Authorization, "Bearer synthetic-github-identity");
        assert.deepEqual(JSON.parse(options.body!), {publisherName: "H9elix"});
        body = {credential: "synthetic-short-lived-credential"};
      }
      return {statusCode: 200, statusMessage: "OK", readBody: async () => JSON.stringify(body)};
    });
    assert.equal(calls.length, 2);
    assert.equal(credential, "synthetic-short-lived-credential");
  });

  it("keeps the short-lived credential out of command arguments and removes runner bearer access", async () => {
    const auth = await authentication(), env = environment();
    const invocation = auth.credentialVerificationInvocation("synthetic-short-lived-credential", env);
    assert.equal(invocation.file, process.execPath);
    assert.deepEqual(invocation.args.slice(1), ["verify-pat", "H9elix"]);
    assert(!invocation.args.join(" ").includes("synthetic-short-lived-credential"));
    assert.equal(invocation.options.env.VSCE_PAT, "synthetic-short-lived-credential");
    assert.equal(invocation.options.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
    assert.equal(invocation.options.env.ACTIONS_ID_TOKEN_REQUEST_URL, undefined);
    assert.equal(invocation.options.timeout, 30000);
    assert.equal(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, "synthetic-runner-credential");
    assert.equal(auth.githubMaskCommand("synthetic%value\n::warning::not-a-command\r"), "::add-mask::synthetic%25value%0A::warning::not-a-command%0D");
  });

  it("masks before read-only verification and reports authentication separately from publication", async () => {
    const auth = await authentication(), calls: string[] = [], logs: string[] = [];
    const result = await auth.verifyMarketplaceAuthentication({environment: environment(), getCredential: async () => "synthetic-credential",
      mask: value => {assert.equal(value, "synthetic-credential"); calls.push("mask");},
      verify: async value => {assert.equal(value, "synthetic-credential"); calls.push("verify");}, log: value => logs.push(value)});
    assert.deepEqual(calls, ["mask", "verify"]);
    assert.deepEqual(result, {publisher: "H9elix", authenticated: true, publisherAccess: true, published: false});
    assert.match(logs.join("\n"), /No extension was uploaded/);
    assert(!logs.join("\n").includes("synthetic-credential"));
  });

  it("redacts exchange and publisher failures, rejects empty credentials and stops on invalid context", async () => {
    const auth = await authentication(), logs: string[] = [];
    const base = {environment: environment(), getCredential: async () => "synthetic-secret", verify: async () => {},
      log: (message: string) => logs.push(message), mask: () => {}};
    for (const message of ["Marketplace OIDC token exchange failed with 403 Forbidden: synthetic-secret", "request failed: synthetic-secret"]) {
      await assert.rejects(auth.verifyMarketplaceAuthentication({...base, getCredential: async () => {throw new Error(message);}}), (error: Error) => {
        assert(!error.message.includes("synthetic-secret"));
        assert.match(error.message, /Trusted credential exchange failed/);
        if (message.includes("403")) assert.match(error.message, /HTTP 403/);
        return true;
      });
    }
    await assert.rejects(auth.verifyMarketplaceAuthentication({...base, getCredential: async () => ""}), /exchange failed/);
    await assert.rejects(auth.verifyMarketplaceAuthentication({...base, verify: async () => {throw new Error("synthetic-secret");}}), (error: Error) => {
      assert(!error.message.includes("synthetic-secret")); assert.match(error.message, /publisher-access verification failed/); return true;
    });
    await assert.rejects(auth.verifyMarketplaceAuthentication({...base, environment: {}, getCredential: async () => assert.fail("Untrusted request reached the exchange")}), /trusted GitHub Actions context/);
    assert.deepEqual(logs, []);
  });

  it("ships a manual-only read-only workflow with no upload command or persistent credentials", () => {
    const workflow = readFileSync(".github/workflows/marketplace-publish.yml", "utf8");
    assert.match(workflow, /^on:\n  workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /^  (?:push|pull_request|release|workflow_run|schedule):/m);
    assert.match(workflow, /id-token: write/);
    assert.match(workflow, /contents: read/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /npm ci --ignore-scripts/);
    assert.match(workflow, /npm run marketplace:auth:check/);
    assert.doesNotMatch(workflow, /contents: write|secrets\.|environment:|vsce publish|gh release create|git push/);
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(manifest.scripts["marketplace:auth:check"], "node scripts/verify-marketplace-auth.mjs");
    assert.doesNotMatch(readFileSync("scripts/verify-marketplace-auth.mjs", "utf8"), /"publish"|\.publish\(|writeFile\(|loginPublisher|FileStore|KeytarStore/);
  });
});
