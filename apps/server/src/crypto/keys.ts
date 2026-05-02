import { env } from "../env.ts";

const AES_KEY_BYTES = 32;

const masterKey: Promise<CryptoKey> = (async () => {
  const raw = Buffer.from(env.MASTER_KEY, "base64");
  if (raw.length < AES_KEY_BYTES) {
    throw new Error(
      `MASTER_KEY must decode to at least ${AES_KEY_BYTES} bytes; got ${raw.length}. Generate one with: openssl rand -base64 32`
    );
  }
  if (raw.length > AES_KEY_BYTES) {
    console.warn(
      `[crypto] MASTER_KEY decoded to ${raw.length} bytes; only the first ${AES_KEY_BYTES} are used.`
    );
  }
  return crypto.subtle.importKey("raw", raw.slice(0, AES_KEY_BYTES), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
})();

export async function encryptKey(plaintext: string): Promise<{ ciphertext: string; nonce: string }> {
  const key = await masterKey;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return {
    ciphertext: Buffer.from(ct).toString("base64"),
    nonce: Buffer.from(iv).toString("base64"),
  };
}

export async function decryptKey(ciphertext: string, nonce: string): Promise<string> {
  const key = await masterKey;
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(nonce, "base64") },
    key,
    Buffer.from(ciphertext, "base64")
  );
  return new TextDecoder().decode(pt);
}
