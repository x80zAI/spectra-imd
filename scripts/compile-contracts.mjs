import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compilerVersion = solc.version();
if (!compilerVersion.startsWith('0.8.30+')) throw new Error(`Expected solc 0.8.30, found ${compilerVersion}`);

const sources = {};
function collect(sourceName) {
  if (sources[sourceName]) return;
  const filename = sourceName.startsWith('@')
    ? path.join(root, 'node_modules', sourceName)
    : path.join(root, sourceName);
  const content = readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  sources[sourceName] = { content };
  for (const match of content.matchAll(/import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']\s*;/g)) {
    const imported = match[1].startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(sourceName), match[1]))
      : match[1];
    collect(imported);
  }
}

for (const file of readdirSync(path.join(root, 'contracts')).filter((name) => name.endsWith('.sol')).sort()) {
  collect(`contracts/${file}`);
}
const settings = {
  optimizer: { enabled: true, runs: 200 },
  evmVersion: 'shanghai',
  metadata: { bytecodeHash: 'ipfs', useLiteralContent: true },
  outputSelection: {
    '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] },
  },
};
const input = { language: 'Solidity', sources: Object.fromEntries(Object.entries(sources).sort()), settings };

function compile(compilerInput) {
  const output = JSON.parse(solc.compile(JSON.stringify(compilerInput)));
  for (const diagnostic of output.errors ?? []) {
    if (diagnostic.severity === 'error') throw new Error(diagnostic.formattedMessage);
    console.warn(diagnostic.formattedMessage);
  }
  return output;
}
function artifact(output, source, name) {
  const compiled = output.contracts[source][name];
  return {
    contractName: name,
    sourceName: source,
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
    deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
    immutableReferences: compiled.evm.deployedBytecode.immutableReferences ?? {},
    metadata: JSON.parse(compiled.metadata),
  };
}
function save(relativePath, content) {
  mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  writeFileSync(path.join(root, relativePath), `${JSON.stringify(content, null, 2)}\n`);
}

const output = compile(input);
const production = {
  compilerVersion,
  evmVersion: settings.evmVersion,
  optimizer: settings.optimizer,
  buildInputSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
  factory: artifact(output, 'contracts/SpectraFactory.sol', 'SpectraFactory'),
  token: artifact(output, 'contracts/SpectraToken.sol', 'SpectraToken'),
  pool: artifact(output, 'contracts/SpectraStaking.sol', 'SpectraStaking'),
};
for (const [name, contract] of Object.entries(production).filter(([, value]) => value?.bytecode)) {
  const runtimeBytes = (contract.deployedBytecode.length - 2) / 2;
  const initBytes = (contract.bytecode.length - 2) / 2;
  if (runtimeBytes > 24_576 || initBytes > 49_152) throw new Error(`${name} exceeds Ethereum bytecode size limits`);
  console.log(`${contract.contractName}: init ${initBytes} bytes, runtime ${runtimeBytes} bytes`);
}
save('artifacts/build-input.json', input);
save('artifacts/contracts.json', production);
save('public/contracts.json', production);

collect('contracts/test/MockTokens.sol');
const testOutput = compile({ ...input, sources: Object.fromEntries(Object.entries(sources).sort()) });
save('artifacts/test-contracts.json', {
  mockIMD: artifact(testOutput, 'contracts/test/MockTokens.sol', 'MockIMD'),
  taxedToken: artifact(testOutput, 'contracts/test/MockTokens.sol', 'TaxedToken'),
  reentrantToken: artifact(testOutput, 'contracts/test/MockTokens.sol', 'ReentrantToken'),
});
console.log(`Compiled reproducibly with ${compilerVersion}; website artifacts exclude local test tokens.`);
