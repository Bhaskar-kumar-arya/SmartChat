# smartchat

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Testing

Testing uses `vitest` under standard Node.js. Since the SQLite module (`better-sqlite3`) needs to match the Node.js version of the running process, you must toggle it between standard Node.js (for testing) and Electron (for running the app).

> [!IMPORTANT]
> Because native binaries are locked while the application is active, **always stop the Electron app (`npm run dev`)** before rebuilding or running tests.

### 1. Running Tests (Rebuilds for Node.js automatically)
To run a specific test file one at a time:
```bash
$ npm run test:run -- src/main/tests/basic.test.ts
```

To run all test suites sequentially (without parallel database lock conflicts):
```bash
$ npm run test:run:all
```

### 2. Switching back to Electron App Execution
After running tests, before running `npm run dev`, you must restore the Electron native module compilation:
```bash
$ npm run test:rebuild:electron
```


