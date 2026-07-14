// Loads .env.local into process.env for local CLI scripts (Next.js loads it
// automatically for the app, but tsx scripts do not).
import fs from "fs";
import path from "path";

const file = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}
