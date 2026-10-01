module.exports = {
  // This library's tests are pure logic - the native module is fully mocked, so
  // they don't need React Native's jest preset (which targets jest 29 and breaks
  // under the project's jest 30). ts-jest + the node environment is sufficient.
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  testRegex: '(/__tests__/.*|\\.(test|spec))\\.(ts|tsx|js)$',
  testPathIgnorePatterns: [
    '\\.snap$',
    '<rootDir>/node_modules/',
    '<rootDir>/lib/',
  ],
  cacheDirectory: '.jest/cache',
};
