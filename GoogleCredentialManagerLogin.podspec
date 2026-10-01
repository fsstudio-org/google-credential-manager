require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# package.json's author is npm's "Name <email> (url)" string; CocoaPods wants
# { name => email }.
author_name = package["author"][/\A[^<(]+/].strip
author_email = package["author"][/<([^>]+)>/, 1]

Pod::Spec.new do |s|
  s.name         = "GoogleCredentialManagerLogin"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = { author_name => author_email }

  s.platforms    = { :ios => min_ios_version_supported }
  # The tag matches what CONTRIBUTING.md tells a maintainer to push: v<version>.
  s.source       = { :git => package["repository"]["url"].sub(/\Agit\+/, ""), :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"
  s.private_header_files = "ios/**/*.h"

  # Pinned to 9.x: requires `signInWithPresentingViewController:...:nonce:completion:`
  # (added in 9.0). Older majors removed `signInWithConfiguration:` and changed
  # the completion block to GIDSignInResult, so a pin is mandatory.
  s.dependency "GoogleSignIn", "~> 9.0"

  install_modules_dependencies(s)
end
