import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Environment = Record<string, string | undefined>;
interface Invocation {file: string; args: string[]; options: {env: Environment; timeout: number}}
interface Publication {
  validatePublicationContext(environment: Environment, event: any, manifest: any, sha: string): string;
  publicationAssets(release: any, manifest: any): Array<{name: string}>;
  publicationInvocation(credential: string, environment: Environment, paths: string[]): Invocation;
  publishVerifiedAssets(options: {environment: Environment; paths: string[]; verify(): Promise<unknown>; credential(environment: Environment): Promise<string>;
    publish(invocation: Invocation): Promise<unknown>; mask(value: string): void}): Promise<void>;
}
const publication = (): Promise<Publication> => import(pathToFileURL(resolve("scripts/publish-marketplace-release.mjs")).href);
const manifest = {name: "c-insight", publisher: "H9elix", version: "0.24.1"};
const sha = "a".repeat(40);
const environment = (): Environment => ({GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_run", GITHUB_REPOSITORY: "H9elix/c-insight", GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: "H9elix/c-insight/.github/workflows/marketplace-publish.yml@refs/heads/main",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.example.test", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-bearer", GH_TOKEN: "synthetic-github-token"});
const event = () => ({repository: {full_name: "H9elix/c-insight"}, workflow_run: {name: "Release", path: ".github/workflows/release.yml",
  event: "push", status: "completed", conclusion: "success", head_repository: {full_name: "H9elix/c-insight"}, head_sha: sha}});
const names = ["win32-x64", "win32-arm64", "linux-x64", "linux-arm64", "linux-armhf", "darwin-x64", "darwin-arm64", "universal"].map(target => `c-insight-0.24.1-${target}.vsix`);
const release = () => ({tag_name: "v0.24.1", draft: false, prerelease: false, assets: [...names, "SHA256SUMS"].map(name => ({name, state: "uploaded",
  browser_download_url: `https://github.com/H9elix/c-insight/releases/download/v0.24.1/${name}`}))});

describe("verified Marketplace publication", () => {
  it("requires a trusted completed Release push and the matching stable tagged commit", async () => {
    const api = await publication(); assert.equal(api.validatePublicationContext(environment(), event(), manifest, sha), "v0.24.1");
    for (const [key, value] of [["GITHUB_ACTIONS", "false"], ["GITHUB_EVENT_NAME", "workflow_dispatch"], ["GITHUB_REF", "refs/tags/v0.24.1"],
      ["GITHUB_REPOSITORY", "fork/c-insight"], ["GITHUB_WORKFLOW_REF", "H9elix/c-insight/.github/workflows/other.yml@refs/heads/main"], ["ACTIONS_ID_TOKEN_REQUEST_TOKEN", ""]]) {
      assert.throws(() => api.validatePublicationContext({...environment(), [key]: value}, event(), manifest, sha));
    }
    for (const changes of [{event: "pull_request"}, {conclusion: "failure"}, {status: "in_progress"}, {name: "CI"}, {path: ".github/workflows/untrusted.yml"},
      {head_repository: {full_name: "fork/c-insight"}}, {head_sha: "b".repeat(40)}]) {
      const value = event(); Object.assign(value.workflow_run, changes); assert.throws(() => api.validatePublicationContext(environment(), value, manifest, sha));
    }
    for (const changes of [{version: "0.24.1-beta.1"}, {publisher: "other"}, {name: "other"}]) {
      assert.throws(() => api.validatePublicationContext(environment(), event(), {...manifest, ...changes}, sha));
    }
  });

  it("accepts exactly the published platform packages, Universal and checksums from the pinned repository", async () => {
    const api = await publication(); assert.equal(api.publicationAssets(release(), manifest).length, 9);
    for (const modify of [(value: any) => {value.draft = true;}, (value: any) => {value.prerelease = true;}, (value: any) => {value.tag_name = "v0.24.0";},
      (value: any) => {value.assets.pop();}, (value: any) => {value.assets.push(value.assets[0]);},
      (value: any) => {value.assets[0].browser_download_url = "https://example.test/untrusted.vsix";}, (value: any) => {value.assets[0].state = "new";}]) {
      const value = release(); modify(value); assert.throws(() => api.publicationAssets(value, manifest));
    }
  });

  it("uploads existing verified bytes with one in-memory short-lived credential and no bearer leakage", async () => {
    const api = await publication(), invocation = api.publicationInvocation("synthetic-short-credential", environment(), names);
    assert.deepEqual(invocation.args.slice(1), ["publish", "--packagePath", ...names, "--skip-duplicate"]);
    assert(!invocation.args.join(" ").includes("synthetic-short-credential"));
    assert.equal(invocation.options.env.VSCE_PAT, "synthetic-short-credential");
    for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"]) assert.equal(invocation.options.env[key], undefined);
    assert.equal(environment().GH_TOKEN, "synthetic-github-token"); assert(invocation.options.timeout <= 15 * 60_000);
    const order: string[] = [];
    await api.publishVerifiedAssets({environment: environment(), paths: names, verify: async () => {order.push("verify");},
      credential: async () => {order.push("credential"); return "synthetic";}, mask: () => {order.push("mask");}, publish: async () => {order.push("publish");}});
    assert.deepEqual(order, ["verify", "credential", "mask", "publish"]);
  });

  it("stops before requesting identity on invalid assets and redacts authentication/upload failures", async () => {
    const api = await publication(), base = {environment: environment(), paths: names, verify: async () => {}, credential: async () => "synthetic-secret", mask: () => {}, publish: async () => {}};
    await assert.rejects(api.publishVerifiedAssets({...base, verify: async () => {throw new Error("checksum mismatch");}, credential: async () => assert.fail("Invalid assets reached OIDC")}), /checksum mismatch/);
    for (const key of ["credential", "publish"] as const) await assert.rejects(api.publishVerifiedAssets({...base, [key]: async () => {throw new Error("synthetic-secret");}}), (error: Error) => {
      assert(!error.message.includes("synthetic-secret")); assert.match(error.message, /Marketplace/); return true;
    });
  });

  it("uses trusted main code after Release success and keeps manual verification upload-free", () => {
    const workflow = readFileSync(".github/workflows/marketplace-publish.yml", "utf8");
    assert.match(workflow, /workflow_run:\n    workflows: \[Release\]\n    types: \[completed\]/);
    assert.match(workflow, /workflow_run\.conclusion == 'success'/); assert.match(workflow, /workflow_run\.event == 'push'/);
    assert.match(workflow, /ref: main/); assert.match(workflow, /fetch-depth: 0/); assert.match(workflow, /persist-credentials: false/);
    assert.doesNotMatch(workflow, /ref:.*head_sha|secrets\.|pull_request_target|contents: write/);
    const script = readFileSync("scripts/publish-marketplace-release.mjs", "utf8");
    assert.match(script, /merge-base.*--is-ancestor/); assert.match(script, /verifyReleaseAssets/);
    assert.match(script, /refs\/tags\/v\$\{manifest\.version\}\^\{\}/);
  });
});
