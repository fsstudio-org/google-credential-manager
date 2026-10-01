// GoogleSignIn 9 depends on AppCheckCore, a Swift pod that imports
// GoogleUtilities and RecaptchaInterop. Neither defines a module, and CocoaPods
// refuses to integrate a Swift pod against them in a static-library build (the
// default for React Native and Expo), so `pod install` fails. Turning on modular
// headers for these pods is the fix CocoaPods itself suggests.
const PODS = ['GoogleUtilities', 'RecaptchaInterop', 'AppCheckCore'];

const BEGIN = '# @generated begin google-credential-manager-modular-headers';
const END = '# @generated end google-credential-manager-modular-headers';

const isDeclared = (contents, pod) =>
  new RegExp(`^\\s*pod\\s+['"]${pod}['"]`, 'm').test(contents);

/**
 * Adds `:modular_headers => true` pod lines to the first target of a Podfile.
 * Returns the new contents, the same contents when nothing needs doing, or
 * `null` when no `target ... do` block was found to put them in.
 */
function addModularHeaders(contents) {
  // Already done by a previous prebuild, or the app opted into modular headers
  // for every pod itself.
  if (contents.includes(BEGIN) || /^\s*use_modular_headers!/m.test(contents)) {
    return contents;
  }

  const pods = PODS.filter((pod) => !isDeclared(contents, pod));
  if (pods.length === 0) return contents;

  const target = /^([ \t]*)target\s+(['"])[^'"]+\2\s+do[ \t]*$/m.exec(contents);
  if (!target) return null;

  const indent = `${target[1]}  `;
  const block = [
    BEGIN,
    ...pods.map((pod) => `pod '${pod}', :modular_headers => true`),
    END,
  ]
    .map((line) => `${indent}${line}`)
    .join('\n');

  const insertAt = target.index + target[0].length;
  return `${contents.slice(0, insertAt)}\n${block}${contents.slice(insertAt)}`;
}

module.exports = { addModularHeaders, PODS };
