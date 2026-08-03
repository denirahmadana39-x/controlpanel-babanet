import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, ".env.example");
const target = resolve(root, ".env");

if (existsSync(target)) {
  console.log(".env already exists, skipping.");
  process.exit(0);
}

copyFileSync(source, target);
console.log(`Created ${target} from .env.example`);
