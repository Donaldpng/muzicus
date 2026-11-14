// npm run release -- 0.2.0 "что нового"
// Bumps version everywhere, commits, tags and pushes → GitHub Actions builds & publishes.
import fs from "node:fs";
import { execSync } from "node:child_process";

const [version, ...msg] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
  console.error("usage: npm run release -- <x.y.z> [notes]");
  process.exit(1);
}
const notes = msg.join(" ") || `MUZICUS v${version}`;

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
pkg.version = version;
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

const conf = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
conf.version = version;
fs.writeFileSync("src-tauri/tauri.conf.json", JSON.stringify(conf, null, 2) + "\n");

let cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
cargo = cargo.replace(/^version = ".*?"/m, `version = "${version}"`);
fs.writeFileSync("src-tauri/Cargo.toml", cargo);

const run = (c) => execSync(c, { stdio: "inherit" });
run("cd src-tauri && cargo update -p muzicus --offline || exit 0");
run("git add -A");
run(`git commit -m "release: v${version}" -m "${notes.replace(/"/g, "'")}"`);
run(`git tag v${version}`);
run("git push");
run(`git push origin v${version}`);
console.log(`\nv${version} pushed — GitHub Actions is building the release.`);
