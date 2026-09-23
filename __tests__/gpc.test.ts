import { describe, it, expect, afterEach, vi } from "vitest";
import {
  platformAsset,
  resolveVersion,
  checksumFor,
  DEFAULT_GPC_VERSION,
  PINNED_CHECKSUMS,
} from "../src/gpc";

describe("platformAsset", () => {
  it("maps supported platforms", () => {
    expect(platformAsset("darwin", "arm64")).toBe("gpc-darwin-arm64");
    expect(platformAsset("darwin", "x64")).toBe("gpc-darwin-x64");
    expect(platformAsset("linux", "arm64")).toBe("gpc-linux-arm64");
    expect(platformAsset("linux", "x64")).toBe("gpc-linux-x64");
    expect(platformAsset("win32", "x64")).toBe("gpc-windows-x64.exe");
  });

  it("throws on an unsupported platform", () => {
    expect(() => platformAsset("linux", "ia32")).toThrow(/Unsupported runner platform/);
  });
});

describe("resolveVersion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults when empty", async () => {
    expect(await resolveVersion("")).toBe(DEFAULT_GPC_VERSION);
  });

  it("strips a leading v", async () => {
    expect(await resolveVersion("v1.2.3")).toBe("1.2.3");
    expect(await resolveVersion("0.9.81")).toBe("0.9.81");
  });

  it("resolves 'latest' via the GitHub API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: "v0.9.99" }),
      }),
    );
    expect(await resolveVersion("latest")).toBe("0.9.99");
  });

  it("throws when 'latest' resolution fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(resolveVersion("latest")).rejects.toThrow(/latest GPC release/);
  });

  it("accepts a prerelease version", async () => {
    expect(await resolveVersion("v1.2.3-beta.1")).toBe("1.2.3-beta.1");
  });

  it("rejects a malformed or path-like version", async () => {
    await expect(resolveVersion("../evil")).rejects.toThrow(/Invalid gpc-version/);
    await expect(resolveVersion("1.2")).rejects.toThrow(/Invalid gpc-version/);
    await expect(resolveVersion("latest/../x")).rejects.toThrow(/Invalid gpc-version/);
  });
});

describe("checksumFor", () => {
  const checksums = [
    "4a8524c174d511d8847c28e10c9a7408e9df970993b28e6648f69c32df8b9c13  gpc-darwin-arm64",
    "360d448e492c8b5c003375dfb8037de2d861162b1a76d0ab69eac36e06b2e69a  gpc-linux-x64",
  ].join("\n");

  it("returns the digest for a known asset", () => {
    expect(checksumFor(checksums, "gpc-linux-x64")).toBe(
      "360d448e492c8b5c003375dfb8037de2d861162b1a76d0ab69eac36e06b2e69a",
    );
  });

  it("throws when the asset is absent", () => {
    expect(() => checksumFor(checksums, "gpc-windows-x64.exe")).toThrow(/No checksum entry/);
  });
});

describe("PINNED_CHECKSUMS", () => {
  it("pins a SHA-256 for every platform asset of the default version", () => {
    const pinned = PINNED_CHECKSUMS[DEFAULT_GPC_VERSION];
    expect(pinned).toBeDefined();
    for (const [platform, arch] of [
      ["darwin", "arm64"],
      ["darwin", "x64"],
      ["linux", "arm64"],
      ["linux", "x64"],
      ["win32", "x64"],
    ] as const) {
      expect(pinned![platformAsset(platform, arch)]).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
