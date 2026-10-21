// Polyfills first: the headless SSH agent task can run without the app root.
import "./src/polyfills";
import "./src/vault-core-runtime";
import "./src/agent/headless";
import "expo-router/entry";
