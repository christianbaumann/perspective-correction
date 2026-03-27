// Wrapper to support "node server.js" with "type": "module" in package.json.
// The actual server is in server.cjs (CommonJS).
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Load the CommonJS server
require('./server.cjs');
