// Launcher acceptance check (00-overview.md §7 criterion 4, packaged launch).
//
// NOT a Playwright test — a separate scripted check that runs the Windows
// double-click launcher exactly as a user would (wscript on the .vbs), then
// asserts:
//   1. the app comes up on the configured port (8137 by default) serving the built UI,
//   2. relaunching is idempotent (no second/stacked server — same listener),
//   3. a release payload's server runs from its own bundled runtime (#179),
//   4. the Stop launcher frees the port,
//   5. the Stop launcher leaves a FOREIGN owner of the port alone (#181).
// macOS launchers ship (launchers/*.command) but cannot be exercised here.
//
// Usage: node e2e/check-launcher.mjs   (Windows only)
import { spawnSync, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
// SM3_LAUNCHER_DIR points the check at an extracted RELEASE ARTIFACT's launchers
// folder instead of this checkout's, so the same acceptance check can be run
// against the shipped payload (#179). Defaults to the repo's launchers/.
const launchers =
  process.env.SM3_LAUNCHER_DIR || resolve(__dirname, "..", "..", "launchers");
const START_VBS = resolve(launchers, "SetMaster 3.vbs");
const STOP_VBS = resolve(launchers, "Stop SetMaster 3.vbs");
// The launchers honour SM3_PORT / SM3_DATA_DIR (inherited by the server they
// spawn), so this check can run against an isolated test instance instead of
// the user's real one: SM3_PORT=8139 SM3_DATA_DIR=... node e2e/check-launcher.mjs
const PORT = Number(process.env.SM3_PORT || 8137);

const log = (m) => process.stdout.write(`${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(path) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: PORT, path, timeout: 2000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Set of PIDs LISTENING on :PORT (idempotency check). */
function listeners() {
  try {
    const out = execSync(`netstat -ano -p tcp`, { encoding: "utf-8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (/LISTENING/.test(line) && line.includes(`:${PORT} `)) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid) pids.add(pid);
      }
    }
    return pids;
  } catch {
    return new Set();
  }
}

/** Full path of a PID's executable ("" if it cannot be read). */
function processPath(pid) {
  if (!pid) return "";
  try {
    return execSync(
      `powershell.exe -NoProfile -Command "(Get-Process -Id ${pid}).Path"`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

async function waitUp(timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await httpGet("/api/status");
    if (r && r.status === 200) return true;
    await sleep(500);
  }
  return false;
}

async function waitDown(timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await httpGet("/api/status");
    if (!r) return true;
    await sleep(500);
  }
  return false;
}

function runVbs(path) {
  // wscript.exe runs the .vbs exactly like a double-click (hidden, async).
  spawnSync("wscript.exe", [path], { windowsHide: true });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  log(`Launcher acceptance check (Windows, port ${PORT})`);
  log(`  launchers: ${launchers}`);
  if (process.env.SM3_DATA_DIR) log(`  data dir: ${process.env.SM3_DATA_DIR}`);

  // Clean slate.
  if ((await httpGet("/api/status")) !== null) {
    runVbs(STOP_VBS);
    await waitDown(15000);
  }

  // 1) Start via the .vbs.
  log("→ launching SetMaster 3.vbs …");
  runVbs(START_VBS);
  const up = await waitUp(40000);
  check(`app comes up on :${PORT}`, up);

  const home = await httpGet("/");
  const servesUi =
    !!home &&
    home.status === 200 &&
    /<div id="root"|<!doctype html/i.test(home.body);
  check("serves the built UI at /", servesUi);

  const firstPids = listeners();
  check(`exactly one listener on :${PORT}`, firstPids.size === 1, [...firstPids].join(","));

  // In a RELEASE PAYLOAD the server must be the bundled runtime, proving the
  // artifact runs on its own Python rather than on whatever the machine happens
  // to have installed (#179). Only asserted when a bundled runtime is present:
  // a developer venv's pythonw.exe reports the base interpreter's path instead.
  const payloadRoot = resolve(launchers, "..");
  const bundled = existsSync(resolve(payloadRoot, "runtime", "python"));
  const exePath = processPath([...firstPids][0]);
  if (bundled) {
    check(
      "server runs from the bundled runtime",
      exePath.toLowerCase().startsWith(payloadRoot.toLowerCase()),
      exePath || "(path unavailable)",
    );
  } else {
    log(`  (dev checkout, no bundled runtime — server python: ${exePath || "unknown"})`);
  }

  // 2) Relaunch → idempotent (same listener PID, no stacked server).
  log("→ relaunching (idempotency) …");
  runVbs(START_VBS);
  await sleep(4000);
  const secondPids = listeners();
  const sameSingle =
    secondPids.size === 1 &&
    [...firstPids][0] === [...secondPids][0] &&
    (await httpGet("/api/status")) !== null;
  check("relaunch is idempotent", sameSingle, [...secondPids].join(","));

  // 3) Stop frees the port.
  log("→ stopping via Stop SetMaster 3.vbs …");
  runVbs(STOP_VBS);
  const down = await waitDown(20000);
  check("Stop launcher frees the port", down);
  check(`no listeners remain on :${PORT}`, listeners().size === 0);

  // 4) Stop must not kill a program that merely owns the port (#181).
  log(`→ stopping with an unrelated program on :${PORT} …`);
  const impostor = http.createServer((_req, res) => res.end("not setmaster"));
  await new Promise((r) => impostor.listen(PORT, "127.0.0.1", r));
  try {
    runVbs(STOP_VBS);
    await sleep(8000);
    check("Stop leaves an unrelated port owner alive", impostor.listening);
    const stillThere = await httpGet("/");
    check(
      `the unrelated program still answers on :${PORT}`,
      !!stillThere && /not setmaster/.test(stillThere.body),
    );
  } finally {
    await new Promise((r) => impostor.close(r));
  }

  const failed = results.filter((r) => !r.ok);
  log(`\n${failed.length === 0 ? "ALL LAUNCHER CHECKS PASSED" : `${failed.length} LAUNCHER CHECK(S) FAILED`}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  log(`error: ${e}`);
  process.exit(1);
});
