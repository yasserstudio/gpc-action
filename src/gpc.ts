import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = "yasserstudio/gpc";

/**
 * Default GPC CLI version the action ships against. Bump this (and PINNED_CHECKSUMS)
 * when cutting an action release that targets a newer GPC. Overridable via `gpc-version`.
 */
export const DEFAULT_GPC_VERSION = "0.9.99";

/**
 * Known-good SHA-256 digests for DEFAULT_GPC_VERSION, committed to this repo. These are
 * the integrity anchor: for the pinned default we verify against these values rather than
 * trusting the checksums.txt that ships in the (mutable) release. Other versions fall back
 * to release-provided checksums with a warning.
 */
export const PINNED_CHECKSUMS: Record<string, Record<string, string>> = {
  "0.9.99": {
    "gpc-darwin-arm64": "a471c3556ae0f04649baa2d87f675ac80fa3b1070c41faedaa2cf29296067d9d",
    "gpc-darwin-x64": "838b9cb8666dc3282723ff2c3b32a8fb19f2f46fc28534ad1412e6806e5c9903",
    "gpc-linux-arm64": "c3cc9d654d629334082b07789c648fdfb1e4bd562ef3668787aedbbf4689eaa1",
    "gpc-linux-x64": "3b1c611afd6f46f5bba5ec249fa0ada0a8b2596520b5a5cf67eb89fe4e868af2",
    "gpc-windows-x64.exe": "4409ff54cc691be26b0f455907fc2ab6979181bc1fdaacb7bbb7e6348754f19e",
  },
  "0.9.98": {
    "gpc-darwin-arm64": "96a4d9e41c34dd361577d244ef55a4ffc2ecebe53cb0d2feb44defb52cb4a12d",
    "gpc-darwin-x64": "6e2f9a8d8b16b38aaf05c65308ca057cf45c681cc9923c8d9b1ec3301524760a",
    "gpc-linux-arm64": "c0d86c344ba0681a79376583188314048ae63a1c775dd1ae246abb22176deb12",
    "gpc-linux-x64": "f628aed8ea42b950bac08a76880e6a3ab14e3e6cdb861cad142a20d9eded1c52",
    "gpc-windows-x64.exe": "2eda687e37b514f3326a2aa15d1479860cd217078368482b56a55c1eeee955fa",
  },
  "0.9.80": {
    "gpc-darwin-arm64": "4a8524c174d511d8847c28e10c9a7408e9df970993b28e6648f69c32df8b9c13",
    "gpc-darwin-x64": "57c7439f5dcc81cbcb0d7b83766639a27c54a3d990d271077e1aa0698d30bb13",
    "gpc-linux-arm64": "1e233a12905d8a2be347e9842afc2770427cfc20bf6cfcbcfef82ad3fa467a8f",
    "gpc-linux-x64": "360d448e492c8b5c003375dfb8037de2d861162b1a76d0ab69eac36e06b2e69a",
    "gpc-windows-x64.exe": "45e204b0bb25fb718056603c74680bf69814cc806abf43efc6109fe77668d5f0",
  },
};

const TOOL_NAME = "gpc";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Map the current runner platform to its GPC release asset name. */
export function platformAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const key = `${platform}/${arch}`;
  switch (key) {
    case "darwin/arm64":
      return "gpc-darwin-arm64";
    case "darwin/x64":
      return "gpc-darwin-x64";
    case "linux/arm64":
      return "gpc-linux-arm64";
    case "linux/x64":
      return "gpc-linux-x64";
    case "win32/x64":
      return "gpc-windows-x64.exe";
    default:
      throw new Error(
        `Unsupported runner platform ${key}. GPC binaries cover darwin (arm64, x64), linux (arm64, x64), and windows (x64).`,
      );
  }
}

/** Resolve and validate the version: '' -> default, 'latest' -> newest release, else strip 'v'. */
export async function resolveVersion(input: string): Promise<string> {
  const raw = input.trim();
  if (!raw) return DEFAULT_GPC_VERSION;

  let version: string;
  if (raw.toLowerCase() === "latest") {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "user-agent": "gpc-action", accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      throw new Error(`Failed to resolve the latest GPC release (HTTP ${res.status}).`);
    }
    const data = (await res.json()) as { tag_name?: string };
    if (!data.tag_name) throw new Error("Latest GPC release has no tag_name.");
    version = data.tag_name.replace(/^v/, "");
  } else {
    version = raw.replace(/^v/, "");
  }

  if (!SEMVER.test(version)) {
    throw new Error(
      `Invalid gpc-version "${input}". Expected a semver version like 0.9.81 (or 'latest').`,
    );
  }
  return version;
}

/** Parse a `sha256  filename` checksums file and return the digest for `asset`. */
export function checksumFor(checksums: string, asset: string): string {
  for (const line of checksums.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sum, name] = trimmed.split(/\s+/);
    if (name === asset) return sum;
  }
  throw new Error(`No checksum entry for ${asset} in checksums.txt.`);
}

/** The expected digest: pinned (committed) for the default version, else release-provided. */
async function expectedChecksum(version: string, asset: string): Promise<string> {
  const pinned = PINNED_CHECKSUMS[version]?.[asset];
  if (pinned) return pinned;

  core.warning(
    `gpc ${version} is not pinned in this action; verifying against the release's own checksums.txt (lower assurance than the default version).`,
  );
  const url = `https://github.com/${REPO}/releases/download/v${version}/checksums.txt`;
  const res = await fetch(url, { headers: { "user-agent": "gpc-action" } });
  if (!res.ok) {
    throw new Error(`Failed to download checksums.txt for v${version} (HTTP ${res.status}).`);
  }
  return checksumFor(await res.text(), asset);
}

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Download (or reuse from cache) the gpc binary for this runner, verifying its SHA-256
 * on every run -- including cache hits -- against the expected digest. Returns an absolute
 * path to the executable.
 */
export async function resolveGpcBinary(versionInput: string): Promise<string> {
  const version = await resolveVersion(versionInput);
  const asset = platformAsset();
  const expected = await expectedChecksum(version, asset);

  const cachedDir = tc.find(TOOL_NAME, version);
  if (cachedDir) {
    const cachedFile = path.join(cachedDir, asset);
    if (fs.existsSync(cachedFile) && sha256(cachedFile) === expected) {
      core.info(`Using cached gpc ${version}`);
      return ensureExecutable(cachedFile);
    }
    core.warning(`Cached gpc ${version} failed verification; re-downloading.`);
  }

  const url = `https://github.com/${REPO}/releases/download/v${version}/${asset}`;
  core.info(`Downloading gpc ${version} (${asset})`);
  const downloaded = await tc.downloadTool(url);

  const actual = sha256(downloaded);
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset} v${version}: expected ${expected}, got ${actual}.`,
    );
  }
  core.info(`Verified checksum for ${asset}`);

  const dir = await tc.cacheFile(downloaded, asset, TOOL_NAME, version);
  return ensureExecutable(path.join(dir, asset));
}

function ensureExecutable(file: string): string {
  if (process.platform !== "win32") {
    fs.chmodSync(file, 0o755);
  }
  return file;
}
