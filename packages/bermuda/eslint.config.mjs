// Flat config for ESLint v9 - extends the repo root config and relaxes
// `max-lines` so that JSDoc/comment lines don't count toward the limit.
import baseConfig from "../../eslint.config.mjs";

export default [
  ...baseConfig,
  {
    // Mirror the root config's max-lines exemptions so tests stay exempt.
    ignores: ["**/tests/**"],
    rules: {
      "max-lines": ["error", { max: 200, skipComments: true }],
    },
  },
];
