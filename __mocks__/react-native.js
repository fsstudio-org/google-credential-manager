// Picked up automatically for the `react-native` node module. The suite runs
// under the plain node environment, so the real entry point can't be loaded.
// Tests switch platform by assigning to Platform.OS.
const Platform = {
  OS: 'android',
  select: (options) =>
    Platform.OS in options ? options[Platform.OS] : options.default,
};

module.exports = {
  Platform,
  TurboModuleRegistry: {
    getEnforcing: () => ({}),
    get: () => null,
  },
};
