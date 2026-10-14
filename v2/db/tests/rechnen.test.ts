import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("Rechenbeispiele aus dem Blueprint", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./rechnen.mjs", import.meta.url))], { encoding: "utf8" });
  if (r.status !== 0) console.log(r.stdout, r.stderr);
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/Prüfungen bestanden, 0 fehlgeschlagen/);
}, 120_000);
