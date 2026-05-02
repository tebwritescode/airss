import sodium from "libsodium-wrappers";
import { env } from "../env.ts";

await sodium.ready;

const masterKey = (() => {
  const raw = Buffer.from(env.MASTER_KEY, "base64");
  if (raw.length !== sodium.crypto_secretbox_KEYBYTES) {
    throw new Error(
      `MASTER_KEY must decode to ${sodium.crypto_secretbox_KEYBYTES} bytes; got ${raw.length}. Generate one with: openssl rand -base64 32`
    );
  }
  return raw;
})();

export function encryptKey(plaintext: string): { ciphertext: string; nonce: string } {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, masterKey);
  return {
    ciphertext: Buffer.from(ct).toString("base64"),
    nonce: Buffer.from(nonce).toString("base64"),
  };
}

export function decryptKey(ciphertext: string, nonce: string): string {
  const ct = Buffer.from(ciphertext, "base64");
  const n = Buffer.from(nonce, "base64");
  const pt = sodium.crypto_secretbox_open_easy(ct, n, masterKey);
  return sodium.to_string(pt);
}
