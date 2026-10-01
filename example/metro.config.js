const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '..');

const config = getDefaultConfig(__dirname);

// The library is linked with `file:..`, so Metro has to watch its source.
config.watchFolders = [root];

// The root carries react / react-native as devDependencies. Without blocking
// them Metro resolves two copies, and the app dies with an invalid-hook or
// TurboModule invariant that points nowhere near the real cause.
const duplicated = ['react', 'react-native', 'react-native-svg'];
config.resolver.blockList = duplicated.map(
  (name) =>
    new RegExp(
      `^${escapeRegExp(path.join(root, 'node_modules', name))}\\${path.sep}.*$`
    )
);

config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = config;
