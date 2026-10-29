// Polyfills first: the headless SSH agent task can run without the app root.
import "./src/polyfills";
// Before any module that translates while it loads.
import "./src/i18n";
import "./src/vault-core-runtime";
import "./src/agent/headless";
import "expo-router/entry";
