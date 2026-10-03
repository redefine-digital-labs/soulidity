import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = resolve(repository, 'packages/animacraft-render-core');
const artifactName = 'maker-v8-render-core.js';
const schemaVersion = 'animacraft.render-core-artifact.v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function check(condition, message) {
  if (!condition) throw new Error(`Animacraft render core: ${message}`);
}
async function readArtifact(directory) {
  const [artifact, metadata, manifest] = await Promise.all([
    readFile(resolve(directory, artifactName)),
    readFile(resolve(directory, 'source.json'), 'utf8').then(JSON.parse),
    readFile(resolve(directory, 'package.json'), 'utf8').then(JSON.parse),
  ]);
  check(metadata.schemaVersion === schemaVersion && metadata.artifact === artifactName
    && metadata.source?.project === 'Animacraft' && metadata.source?.file === artifactName,
  'source metadata identity is invalid');
  check(/^[0-9a-f]{64}$/.test(metadata.sha256) && Number.isSafeInteger(metadata.byteLength)
    && metadata.byteLength > 0, 'source metadata hash/length is invalid');
  check(manifest.name === '@soulidity/animacraft-render-core' && manifest.private === true && manifest.type === 'module'
    && manifest.main === `./${artifactName}` && manifest.types === './index.d.ts'
    && !Object.hasOwn(manifest, 'browser') && Object.keys(manifest.exports ?? {}).join() === '.'
    && Object.keys(manifest.exports['.']).sort().join() === 'default,import,types'
    && manifest.exports?.['.']?.import === `./${artifactName}` && manifest.exports['.'].default === `./${artifactName}`
    && manifest.exports['.'].types === './index.d.ts', 'package must export the original module directly');
  check(artifact.length === metadata.byteLength && digest(artifact) === metadata.sha256,
    'packaged module differs from its pinned source SHA-256 or byte length');
  return { artifact, metadata };
}

/** Read-only. CI/deployment needs only the committed artifact and metadata.
 * Comparing an authoring checkout is opt-in; no absolute source path is baked in. */
export async function verifyAnimacraftRenderCore({ sourceFile, directory = packageDirectory } = {}) {
  const { artifact, metadata } = await readArtifact(directory);
  if (sourceFile !== undefined) {
    const source = await readFile(resolve(sourceFile));
    check(source.equals(artifact), 'explicit source file does not byte-match the packaged module');
  }
  return { artifact: artifactName, sha256: metadata.sha256, byteLength: artifact.length, sourceCompared: sourceFile !== undefined };
}

/** Prints an apply_patch input only; neither mode writes or installs anything. */
export async function printAnimacraftRenderCoreUpdatePatch(sourceFile, { directory = packageDirectory } = {}) {
  check(typeof sourceFile === 'string' && sourceFile.length > 0, '--print-update-patch requires --source-file');
  const { artifact, metadata } = await readArtifact(directory);
  const source = await readFile(resolve(sourceFile));
  check(source.length > 0 && Buffer.from(source.toString('utf8')).equals(source)
    && source.at(-1) === 10 && !source.includes(13), 'source must be nonempty UTF-8 text with LF endings and final newline');
  const updated = { ...metadata, sha256: digest(source), byteLength: source.length };
  const oldMetadata = await readFile(resolve(directory, 'source.json'), 'utf8');
  const newMetadata = `${JSON.stringify(updated, null, 2)}\n`;
  const chunks = ['*** Begin Patch'];
  for (const [file, before, after] of [[artifactName, artifact.toString('utf8'), source.toString('utf8')],
    ['source.json', oldMetadata, newMetadata]]) {
    if (before === after) continue;
    const lines = (value, prefix) => value.replace(/\n$/, '').split('\n').map(line => prefix + line).join('\n');
    chunks.push(`*** Update File: ${resolve(directory, file)}\n@@\n${lines(before, '-')}\n${lines(after, '+')}`);
  }
  chunks.push('*** End Patch');
  return `${chunks.join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); let sourceFile; let printPatch = false;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--source-file' && sourceFile === undefined && args[index + 1] && !args[index + 1].startsWith('--')) {
        sourceFile = args[++index];
      } else if (args[index] === '--print-update-patch' && !printPatch) printPatch = true;
      else throw new Error('Usage: node scripts/verify-animacraft-render-core.mjs [--source-file PATH] [--print-update-patch]');
    }
    if (printPatch) process.stdout.write(await printAnimacraftRenderCoreUpdatePatch(sourceFile));
    else process.stdout.write(`${JSON.stringify(await verifyAnimacraftRenderCore({ sourceFile }))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`); process.exitCode = 1;
  }
}
