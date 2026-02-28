const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Expo Config Plugin: withAbiSplits
 *
 * Adds ABI splits configuration to android/app/build.gradle so that
 * `assembleRelease` generates per-architecture APKs:
 *   - app-arm64-v8a-release.apk
 *   - app-armeabi-v7a-release.apk
 *   - app-x86-release.apk
 *   - app-x86_64-release.apk
 */
const withAbiSplits = (config) => {
  return withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;

    // Only inject if not already present
    if (buildGradle.includes("splits {")) {
      return config;
    }

    const splitsBlock = `
    splits {
        abi {
            reset()
            enable true
            universalApk false
            include "armeabi-v7a", "arm64-v8a", "x86", "x86_64"
        }
    }`;

    // Insert the splits block right before the `packagingOptions` block
    config.modResults.contents = buildGradle.replace(
      /(\s*packagingOptions\s*\{)/,
      `${splitsBlock}\n$1`
    );

    return config;
  });
};

module.exports = withAbiSplits;
