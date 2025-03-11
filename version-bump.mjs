import { readFileSync, writeFileSync } from 'fs';

let targetVersion = process.env.npm_package_version;
// increment version
let versionParts = targetVersion.split('.');
let patchVersion = parseInt(versionParts.pop());
patchVersion++;
versionParts.push(patchVersion);
targetVersion = versionParts.join('.');
console.warn(`Bumping version to ${targetVersion}`);

// save version in package.json
let packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
packageJson.version = targetVersion;
writeFileSync('package.json', JSON.stringify(packageJson, null, '\t'));

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
