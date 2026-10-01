import {
  DOCS_URL,
  ERROR_REMEDIES,
  GoogleCredentialLoginError,
} from '../errors';

// Declared rather than imported: the package has no @types/node, and pulling one
// in for a single readFileSync would widen the dev dependency tree for nothing.
declare const require: (id: 'fs') => {
  readFileSync(path: string, encoding: 'utf8'): string;
};
declare const __dirname: string;

const { readFileSync } = require('fs');

/**
 * The error codes are a contract published in three places. A code that exists
 * in one and not the others is the failure this suite exists to prevent: the
 * docs still read as correct, which is why nobody notices.
 */
const read = (name: string) =>
  readFileSync(`${__dirname}/../../${name}`, 'utf8');

const codes = Object.keys(ERROR_REMEDIES);

describe('AGENTS.md', () => {
  const agents = read('AGENTS.md');

  it.each(codes)('documents %s under its own heading', (code) => {
    expect(agents).toContain(`### ${code}`);
  });

  it.each(codes)('has a heading matching the anchor emitted for %s', (code) => {
    // Errors point callers at `${DOCS_URL}#${code.toLowerCase()}`. GitHub
    // slugifies a heading by lowercasing and keeping underscores, so the
    // anchor resolves only while the heading is the bare code.
    const anchor = new GoogleCredentialLoginError(code, 'x').message
      .split('→ Docs: ')[1]
      ?.trim();

    expect(anchor).toBe(`${DOCS_URL}#${code.toLowerCase()}`);
    expect(agents).toContain(`### ${anchor!.split('#')[1]!.toUpperCase()}`);
  });
});

describe('native modules', () => {
  const sources = [
    read(
      'android/src/main/java/com/googlecredentialmanagerlogin/GoogleCredentialManagerLoginModule.kt'
    ),
    read('ios/GoogleCredentialManagerLogin.mm'),
  ].join('\n');

  // Matches the literal codes the native modules reject with:
  //   promise.reject("NO_ACTIVITY", …)   onError("NOT_CONFIGURED", …)
  //   PayloadResult.Failure("PARSE_ERROR", …)   "SIGN_IN_CANCELLED" to "…"
  //   reject(@"VIEW_CONTROLLER_MISSING", …)
  const rejected = new Set<string>();
  for (const pattern of [
    /(?:reject|onError|Failure)\(\s*@?"([A-Z][A-Z_]{2,})"/g,
    /"([A-Z][A-Z_]{2,})"\s+to\s+"/g,
  ]) {
    for (const match of sources.matchAll(pattern)) rejected.add(match[1]!);
  }

  // Guards the guard: a regex that silently matched nothing would make every
  // assertion below pass while checking nothing at all.
  it('finds the codes the native modules actually reject with', () => {
    expect(rejected.size).toBeGreaterThan(15);
    expect(rejected).toContain('NO_ACTIVITY');
    expect(rejected).toContain('SIGN_IN_CANCELLED');
    expect(rejected).toContain('VIEW_CONTROLLER_MISSING');
  });

  it('rejects with no code that lacks a remedy', () => {
    const undocumented = [...rejected].filter((code) => !ERROR_REMEDIES[code]);

    expect(undocumented).toEqual([]);
  });
});

describe('README.md', () => {
  const readme = read('README.md');

  it.each(codes)('lists %s in the error table', (code) => {
    expect(readme).toContain(`\`${code}\``);
  });
});
