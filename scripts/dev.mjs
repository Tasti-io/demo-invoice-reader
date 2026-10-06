#!/usr/bin/env node
// Local preview: serves public/ and routes /api/read through the same handler
// Vercel will run. The request is handed over as a stream, as Vercel does, so the
// upload path is exercised for real rather than through a pre-parsed body.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Local convenience only: pick the key up from the file it already lives in, so it
// never goes on a command line. On Vercel it is an environment variable.
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    const line = readFileSync(path.join(os.homedir(), ".tasti/anthropic.env"), "utf8")
      .split("\n").find((l) => l.startsWith("ANTHROPIC_API_KEY="));
    if (line) process.env.ANTHROPIC_API_KEY = line.slice("ANTHROPIC_API_KEY=".length).trim();
  } catch { /* no key: every upload gets the prepared example, which is what it is for */ }
}

const { default: read } = await import("../api/read.js");

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".pdf": "application/pdf" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/read") {
    const shim = {
      setHeader: (k, v) => res.setHeader(k, v),
      status: (c) => ({ end: (b) => { res.statusCode = c; res.end(b); } }),
    };
    return read(req, shim);
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  try {
    const content = await readFile(path.join(ROOT, "public", path.normalize(file).replace(/^(\.\.[/\\])+/, "")));
    res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(3030, () => console.log("invoice reader on http://localhost:3030"));
