import type { CompanyRuleset } from "./types";
import { demoRuleset } from "./demo";

// In-memory ruleset (demo). Resets on server restart.
let currentRules: CompanyRuleset = demoRuleset;

export function getCurrentRuleset() {
  return currentRules;
}

export function setCurrentRuleset(next: CompanyRuleset) {
  currentRules = next;
}
