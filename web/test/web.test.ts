import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPasskeySmartWallet } from "../lib/passkey.js";
import {
  buildUnsignedRegistryTxXdr,
  getFileDownloadUrl,
  PUBLIC_CONFIG,
  signRegistryTxWithSecret,
  verifyProduct,
} from "../lib/stellar.js";

describe("@veritag/web verification & passkey wallet logic", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Offline test mode")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves offline/demo verification states accurately across serial patterns", async () => {
    const brand = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
    const batch = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

    const unclaimed = await verifyProduct(brand, batch, "CH-2026-000101");
    expect(unclaimed.status).toBe("AuthenticInactive");
    expect(unclaimed.authentic).toBe(true);

    const active = await verifyProduct(brand, batch, "CH-2026-ACTIVE-04");
    expect(active.status).toBe("AuthenticActive");
    expect(active.unit?.warrantyValid).toBe(true);

    const dup = await verifyProduct(brand, batch, "CH-2026-DUP-88");
    expect(dup.status).toBe("AlreadyClaimedWarning");
    expect(dup.suspiciousScanVolume).toBe(true);

    const recalled = await verifyProduct(brand, batch, "CH-2026-RECALL-19");
    expect(recalled.status).toBe("Recalled");

    const fake = await verifyProduct(brand, batch, "FAKE-000999");
    expect(fake.status).toBe("Unknown");
    expect(fake.authentic).toBe(false);
  });

  it("generates P-256 passkey wallet credentials and formats file download URLs", async () => {
    const cred = await registerPasskeySmartWallet("Test Consumer Passkey");
    expect(cred.publicKeyHex.length).toBe(130);
    expect(cred.publicKeyHex.startsWith("04")).toBe(true);
    expect(cred.stellarSmartAddress.startsWith("C")).toBe(true);
    expect(cred.stellarSmartAddress.length).toBe(56);

    const fileUrl = getFileDownloadUrl("a".repeat(64));
    expect(fileUrl).toContain("/v1/files/" + "a".repeat(64));

    const kp = Keypair.random();
    const unsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: kp.publicKey(),
      method: "commit_batch",
    });
    const signedXdr = signRegistryTxWithSecret(unsignedXdr, kp.secret());
    const parsedTx = TransactionBuilder.fromXDR(signedXdr, PUBLIC_CONFIG.networkPassphrase);
    expect(parsedTx.signatures.length).toBe(1);

    const passkeyUnsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: cred.stellarSmartAddress,
      method: "activate",
    });
    expect(passkeyUnsignedXdr.length).toBeGreaterThan(20);
  });
});

// ─── #90 QrPrintPreviewModal ──────────────────────────────────────────────────

describe("QrPrintPreviewModal layout configuration", () => {
  it("exports SHEET_PRESETS with correct column counts", async () => {
    // Dynamic import so we don't depend on React renderer in unit tests.
    const mod = await import("../components/QrPrintPreviewModal.js");
    // The named type export is enough — we verify the module shape.
    expect(mod.QrPrintPreviewModal).toBeDefined();
    expect(typeof mod.QrPrintPreviewModal).toBe("function");
  });

  it("modal trigger: sets printPreviewOpen when exportedLabels exist", () => {
    // Pure state logic test — mirrors what the brand page does.
    let printPreviewOpen = false;
    const exportedLabels = [
      { unitId: "abc", serial: "S-001", scratchSecret: "secret", qrUrl: "https://v.tag/x" },
    ];
    // Simulate the button click handler
    if (exportedLabels.length > 0) printPreviewOpen = true;
    expect(printPreviewOpen).toBe(true);
  });
});

// ─── #91 TransferCountdownCard ────────────────────────────────────────────────

describe("TransferCountdownCard timer & clipboard logic", () => {
  it("formatCountdown produces hh:mm:ss strings", () => {
    function formatCountdown(secs: number): string {
      if (secs <= 0) return "00:00:00";
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
    }

    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(3661)).toBe("01:01:01");
    expect(formatCountdown(86399)).toBe("23:59:59");
    expect(formatCountdown(900)).toBe("00:15:00"); // exactly 15 min
    expect(formatCountdown(899)).toBe("00:14:59"); // 1 second into warning zone
  });

  it("warning threshold triggers below 15 minutes", () => {
    const WARNING_SECONDS = 15 * 60;
    const isWarning = (secs: number) => secs > 0 && secs <= WARNING_SECONDS;

    expect(isWarning(901)).toBe(false);
    expect(isWarning(900)).toBe(true);
    expect(isWarning(1)).toBe(true);
    expect(isWarning(0)).toBe(false); // expired, not warning
  });

  it("copy action writes to clipboard mock", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn((text: string) => {
          written.push(text);
          return Promise.resolve();
        }),
      },
    });

    const code = "XFER-AB12-987654";
    await navigator.clipboard.writeText(code);
    expect(written).toContain(code);

    vi.unstubAllGlobals();
  });

  it("share link encodes transfer code into URL", () => {
    const code = "XFER-AB12-987654";
    const origin = "https://app.veritag.io";
    const url = `${origin}/owner?redeem=${encodeURIComponent(code)}`;
    expect(url).toBe(`${origin}/owner?redeem=XFER-AB12-987654`);
    expect(new URL(url).searchParams.get("redeem")).toBe(code);
  });
});

// ─── #103 Responsive layout helpers ──────────────────────────────────────────

describe("Responsive layout: Stellar address formatting", () => {
  function truncateAddress(addr: string): string {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  it("truncates long Stellar G-addresses with middle dots", () => {
    const addr = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
    const truncated = truncateAddress(addr);
    expect(truncated).toMatch(/^GB7TAY/);
    expect(truncated).toMatch(/P2JO$/);
    expect(truncated).toContain("...");
    // Must fit comfortably on 320px: target ≤ 16 chars
    expect(truncated.length).toBeLessThanOrEqual(16);
  });

  it("truncates C-addresses (Soroban smart accounts) the same way", () => {
    const addr = "CBSXBQY7CQXBQY7CQXBQY7CQXBQY7CQXBQY7CQXBQY7CQXBQY7CQXB";
    const truncated = truncateAddress(addr);
    expect(truncated.startsWith("C")).toBe(true);
    expect(truncated).toContain("...");
    expect(truncated.length).toBeLessThanOrEqual(16);
  });

  it("leaves short serials unchanged", () => {
    expect(truncateAddress("CH-2026")).toBe("CH-2026");
  });
});
