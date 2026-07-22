// eslint.config.js — flat config, aligné sur le tsconfig strict existant.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**"] },
  tseslint.configs.recommended,
  {
    rules: {
      // noUnusedLocals/Parameters (tsconfig.json) couvrent déjà ceci au build.
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
