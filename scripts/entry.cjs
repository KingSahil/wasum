// entry.cjs  –  pkg entry point bootstrap
//
// PURPOSE: Guarantee dotenv is loaded (with the correct .env path) BEFORE
// any bundled module code runs.  In a CJS bundle, require() calls execute
// in the order they appear, but dotenv must fire before the Groq /
// whatsapp-web.js initialisation at the top of main.js.
//
// When packaged by @yao-pkg/pkg:
//   process.pkg           == true
//   process.execPath      == full path to wa-summariser.exe
//   => .env lives next to the .exe
//
// In plain node (dev / debugging):
//   => .env lives in process.cwd()
//
// This file lives in scripts/ and loads the bundle from ../dist.

const path = require('path');
const dotenv = require('dotenv');

const envDir = process.pkg
    ? path.dirname(process.execPath)
    : process.cwd();

const result = dotenv.config({ path: path.join(envDir, '.env') });
if (result.error && result.error.code !== 'ENOENT') {
    console.warn('[BOOT] dotenv warning:', result.error.message);
}

// Load the actual application bundle
require('../dist/bundle.cjs');
