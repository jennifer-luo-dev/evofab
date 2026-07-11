import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, sanitizeOutput } from "../scripts/prusalink-probe";

test("PrusaLink probe: parses args correctly with default fallbacks", () => {
  const parsed = parseArgs(["--host", "192.168.1.100"]);
  assert.equal(parsed.host, "192.168.1.100");
  assert.equal(parsed.keyFile, "");
  assert.equal(parsed.samples, 1);
  assert.equal(parsed.interval, 2);
});

test("PrusaLink probe: parses custom flags", () => {
  const parsed = parseArgs([
    "--host",
    "192.168.1.100",
    "--key-file",
    ".secrets/test.key",
    "--samples",
    "5",
    "--interval",
    "3.5",
  ]);
  assert.equal(parsed.host, "192.168.1.100");
  assert.equal(parsed.keyFile, ".secrets/test.key");
  assert.equal(parsed.samples, 5);
  assert.equal(parsed.interval, 3.5);
});

test("PrusaLink probe: sanitizer removes sensitive data", () => {
  const ipLog = "Connecting to printer at 192.168.1.100 ...";
  assert.equal(
    sanitizeOutput(ipLog),
    "Connecting to printer at <IP_ADDRESS> ...",
  );

  const hostLog = "Tufts domain resolves to buddy-mini.tufts.edu host.";
  assert.equal(
    sanitizeOutput(hostLog),
    "Tufts domain resolves to <TUFTS_HOST> host.",
  );

  const headerLog = "Sending headers: { X-Api-Key: my-api-key-value-123 }";
  assert.equal(
    sanitizeOutput(headerLog),
    "Sending headers: { X-Api-Key: <API_KEY> }",
  );

  const authLog = "Authorization: Bearer secret-auth-token-abc";
  assert.equal(sanitizeOutput(authLog), "Authorization: Bearer <TOKEN>");

  const serialLog = "Buddy Board Serial: CZPX1234567890123456";
  assert.equal(
    sanitizeOutput(serialLog),
    "Buddy Board Serial: <SERIAL_NUMBER>",
  );

  const unixPathLog = "Reading file /var/lib/prusalink/gcode/cube.gcode now";
  assert.equal(sanitizeOutput(unixPathLog), "Reading file <FILE_PATH> now");

  const winPathLog =
    "Reading file C:\\Users\\William\\Documents\\test.gcode now";
  assert.equal(sanitizeOutput(winPathLog), "Reading file <FILE_PATH> now");
});

test("PrusaLink probe: sanitizer strips custom sentinel secret", () => {
  const sentinel = "sentinel-secret-value-xyz";
  const logLine = `Failed connection with API Key: ${sentinel}`;
  const sanitized = sanitizeOutput(logLine, [sentinel]);

  assert.ok(
    !sanitized.includes(sentinel),
    "Sentinel secret must not survive in output",
  );
  assert.ok(
    sanitized.includes("<SECRET>"),
    "Sentinel secret must be replaced with placeholder",
  );
});
