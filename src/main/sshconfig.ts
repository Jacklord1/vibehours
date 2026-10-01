// Host names from the user's own SSH config. The app lists these and stores
// the chosen name only; it never reads keys, addresses or passwords.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface SshConfigLines {
  hosts: string[];
  includes: string[];
}

/** A name is offered only if it is a plain alias, not a pattern or a flag. */
export function isPlainHost(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name);
}

export function parseSshConfig(text: string): SshConfigLines {
  const hosts: string[] = [];
  const includes: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line);
    if (!m) continue;
    const keyword = m[1].toLowerCase();
    const values = m[2].split(/\s+/).map((v) => v.replace(/^"(.*)"$/, "$1"));
    if (keyword === "host") hosts.push(...values.filter(isPlainHost));
    if (keyword === "include") includes.push(...values.filter((v) => v !== ""));
  }
  return { hosts, includes };
}

function expandInclude(pattern: string, sshDir: string): string[] {
  let p = pattern;
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) p = path.join(sshDir, p);
  const dir = path.dirname(p);
  const base = path.basename(p);
  if (!/[*?]/.test(base)) return [p];
  // A wildcard in the file name only, which is how Include is used in practice.
  const escaped = base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  const match = new RegExp(`^${escaped}$`);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => match.test(f))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Hosts in `~/.ssh/config` and the files it includes, in file order. */
export function listSshHosts(configPath = path.join(os.homedir(), ".ssh", "config")): string[] {
  const sshDir = path.dirname(configPath);
  const seenFiles = new Set<string>();
  const hosts: string[] = [];
  const read = (file: string, depth: number) => {
    if (depth > 4 || seenFiles.has(file)) return;
    seenFiles.add(file);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    const parsed = parseSshConfig(text);
    for (const h of parsed.hosts) if (!hosts.includes(h)) hosts.push(h);
    for (const inc of parsed.includes) {
      for (const f of expandInclude(inc, sshDir)) read(f, depth + 1);
    }
  };
  read(configPath, 0);
  return hosts;
}
