import { generateKeyPairSync } from "node:crypto";
const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
console.log(`LEDGER_SIGNING_KEY=${Buffer.from(pem).toString("base64")}`);
