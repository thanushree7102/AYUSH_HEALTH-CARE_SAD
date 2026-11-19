name: Frontend CI

on:
  push:
    branches: [frontend, main]
  pull_request:
    branches: [main]

jobs:
  syntax-check:
    name: Syntax and import check (works on this branch alone)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install esbuild (checker only)
        run: npm install --prefix "$RUNNER_TEMP/tools" esbuild
      - name: Check every .js/.jsx parses and every import exists
        run: node scripts/ci-check.cjs
        env:
          CI_TOOLS: ${{ runner.temp }}/tools

  build:
    name: Install and Vite build (needs complete project)
    runs-on: ubuntu-latest
    needs: syntax-check
    steps:
      - uses: actions/checkout@v4

      - name: Detect complete project
        id: detect
        run: |
          if [ -f package.json ]; then
            echo "ready=true" >> "$GITHUB_OUTPUT"
          else
            echo "ready=false" >> "$GITHUB_OUTPUT"
            echo "::notice::package.json not found. Skipping build. Merge with main first."
          fi

      - uses: actions/setup-node@v4
        if: steps.detect.outputs.ready == 'true'
        with:
          node-version: 20

      - name: Install dependencies
        if: steps.detect.outputs.ready == 'true'
        run: npm ci || npm install

      - name: Build frontend
        if: steps.detect.outputs.ready == 'true'
        run: npm run build
