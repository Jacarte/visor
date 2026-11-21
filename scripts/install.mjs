#!/usr/bin/env node
// Artifact-only, exclusive installation. Never enables Visor or edits vault configuration.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const names = ['main.js', 'manifest.json', 'styles.css'];
const digest = data => createHash('sha256').update(data).digest('hex');
export async function inspectDirectory(directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe directory ancestor: ${current}`);
  }
  if (await fs.realpath(absolute) !== absolute) throw new Error(`Noncanonical directory: ${absolute}`);
  return absolute;
}
export async function installArtifacts(source, vault) {
  source = await inspectDirectory(source); vault = await inspectDirectory(vault);
  const artifacts = [];
  for (const name of names) {
    const file = path.join(source, name); const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular artifact: ${file}`);
    const bytes = await fs.readFile(file); if (!bytes.length) throw new Error(`Empty artifact: ${name}`);
    artifacts.push({ name, bytes, size: bytes.length, sha256: digest(bytes) });
  }
  const manifest = JSON.parse(artifacts.find(a => a.name === 'manifest.json').bytes.toString());
  if (manifest.id !== 'visor' || manifest.isDesktopOnly !== true) throw new Error('Unexpected Visor manifest.');
  const parent = await inspectDirectory(path.join(vault, '.obsidian', 'plugins'));
  const target = path.join(parent, 'visor'); const owned = []; let created = false;
  try {
    await fs.mkdir(target); created = true; // Exclusive: an existing directory is a hard conflict.
    for (const artifact of artifacts) {
      await inspectDirectory(target);
      const file = path.join(target, artifact.name);
      const handle = await fs.open(file, 'wx', 0o644);
      const entry = { file, bytes: artifact.bytes, complete: false }; owned.push(entry);
      try { await handle.writeFile(artifact.bytes); entry.complete = true; } finally { await handle.close(); }
      const actual = await fs.readFile(file);
      if (actual.length !== artifact.size || digest(actual) !== artifact.sha256) throw new Error(`Artifact verification failed: ${artifact.name}`);
    }
    return { target, artifacts: artifacts.map(({ name, size, sha256 }) => ({ name, size, sha256 })), activation: 'pending — enable Visor alone using Obsidian UI or its public plugin:enable command' };
  } catch (error) {
    const retained = [];
    if (created) {
      // Do not follow a newly substituted directory or remove files changed by someone else.
      let safe = true; try { await inspectDirectory(target); } catch { safe = false; }
      for (const entry of owned.reverse()) {
        try {
          if (!safe || !entry.complete) { retained.push(entry.file); continue; }
          const stat = await fs.lstat(entry.file);
          if (!stat.isFile() || stat.isSymbolicLink()) { retained.push(entry.file); continue; }
          const actual = await fs.readFile(entry.file);
          if (!actual.equals(entry.bytes)) { retained.push(entry.file); continue; }
          await fs.unlink(entry.file);
        } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') retained.push(entry.file); }
      }
      if (safe) try { await fs.rmdir(target); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') retained.push(target); }
    }
    throw new Error(`Installation stopped: ${error.message}${retained.length ? `; retained changed/uncertain paths: ${retained.join(', ')}` : ''}`, { cause: error });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { console.error('Usage: node scripts/install.mjs /absolute/path/to/vault'); process.exitCode = 1; }
  else try { console.log(JSON.stringify(await installArtifacts(path.resolve(fileURLToPath(new URL('..', import.meta.url))), process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
