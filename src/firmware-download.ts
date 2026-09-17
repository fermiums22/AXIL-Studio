import release from "./released-firmware.json";

let image: ArrayBuffer | undefined;
const decode = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value), c => c.charCodeAt(0));

export async function unlockReleasedFirmware(password: string): Promise<void> {
  if (image) return;
  try {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.trim()), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: decode(release.salt), iterations: release.iterations }, material,
      { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(release.iv),
      additionalData: new TextEncoder().encode(JSON.stringify(release.metadata)) }, key, decode(release.ciphertext));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    if (bytes.byteLength !== release.metadata.size || hash !== release.metadata.sha256) throw Error("Invalid release");
    image = bytes;
  } catch {
    throw Error("Could not unlock firmware. Check the password or reload the page.");
  }
}

export function getReleasedFirmware(): File {
  if (!image) throw Error("Unlock access before selecting release firmware.");
  return new File([image], release.metadata.filename, { type: "application/octet-stream" });
}
