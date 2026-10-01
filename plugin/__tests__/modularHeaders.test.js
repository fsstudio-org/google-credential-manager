const { addModularHeaders } = require('../modularHeaders');

const PODFILE =
  "platform :ios, '15.1'\n\ntarget 'MyApp' do\n  use_expo_modules!\nend\n";

describe('addModularHeaders', () => {
  it('adds the three pods right after the target line', () => {
    expect(addModularHeaders(PODFILE)).toBe(
      "platform :ios, '15.1'\n\n" +
        "target 'MyApp' do\n" +
        '  # @generated begin google-credential-manager-modular-headers\n' +
        "  pod 'GoogleUtilities', :modular_headers => true\n" +
        "  pod 'RecaptchaInterop', :modular_headers => true\n" +
        "  pod 'AppCheckCore', :modular_headers => true\n" +
        '  # @generated end google-credential-manager-modular-headers\n' +
        '  use_expo_modules!\n' +
        'end\n'
    );
  });

  it('is idempotent across prebuilds', () => {
    const once = addModularHeaders(PODFILE);

    expect(addModularHeaders(once)).toBe(once);
  });

  it('leaves a Podfile that already uses modular headers alone', () => {
    const podfile = `use_modular_headers!\n${PODFILE}`;

    expect(addModularHeaders(podfile)).toBe(podfile);
  });

  it('does not redeclare a pod the app already declares', () => {
    const podfile =
      "target 'MyApp' do\n  pod 'GoogleUtilities', :modular_headers => true\nend\n";
    const result = addModularHeaders(podfile);

    expect(result.match(/pod 'GoogleUtilities'/g)).toHaveLength(1);
    expect(result).toContain("pod 'RecaptchaInterop'");
  });

  it('handles double-quoted target names', () => {
    expect(addModularHeaders('target "MyApp" do\nend\n')).toContain(
      "pod 'AppCheckCore'"
    );
  });

  it('returns null when there is no target block', () => {
    expect(addModularHeaders("platform :ios, '15.1'\n")).toBeNull();
  });
});
