import fs from 'node:fs';

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  throw new Error('npm_package_version is required. Run this through npm version.');
}

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.version = targetVersion;
fs.writeFileSync('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
  versions[targetVersion] = manifest.minAppVersion;
  fs.writeFileSync('versions.json', `${JSON.stringify(versions, null, 2)}\n`);
}
