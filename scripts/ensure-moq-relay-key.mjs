import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const output = resolve(
  process.env.HELENA_MOQ_RELAY_KEY ?? ".helena/moq/root.jwk",
);
const secret =
  process.env.HELENA_MOQ_RELAY_SECRET ?? "helena-moq-relay-dev-secret";

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `${JSON.stringify(
    {
      alg: "HS256",
      key_ops: ["sign", "verify"],
      kty: "oct",
      k: base64Url(secret),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

console.log(`wrote moq-relay HS256 key: ${output}`);
