// Harness commands for runners that are not TypeScript (the Python side). One JSON object on stdout.
//   tsx harness/cli.ts begin <scenario>                      -> { userId, agentKey }
//   tsx harness/cli.ts step <userId> <action>                -> { ok, detail }
//   tsx harness/cli.ts finish <scenario> <userId>  (stdin: { toolCalls, finalTexts, harnessFailures })
//                                                            -> { status, reason, injection, notes, purchases, cleanup }
import { begin, finish, harnessStep } from "./lifecycle";
import { closeDb } from "./seed";

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  let out: unknown;
  if (cmd === "begin" && a) out = await begin(a);
  else if (cmd === "step" && a && b) out = await harnessStep(a, b);
  else if (cmd === "finish" && a && b) {
    const body = JSON.parse((await stdin()) || "{}") as { toolCalls?: []; finalTexts?: string[]; harnessFailures?: string[] };
    out = await finish(a, b, body.toolCalls ?? [], body.finalTexts ?? [], body.harnessFailures ?? []);
  } else throw new Error("usage: cli.ts begin <scenario> | step <userId> <action> | finish <scenario> <userId>");
  process.stdout.write(`${JSON.stringify(out)}\n`);
}
main().then(() => closeDb()).then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
