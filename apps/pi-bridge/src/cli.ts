// The entry the package bundles: `npx mygitnotes-pi-bridge`. The bridge itself lives in apps/local-server.
import { main } from '../../local-server/src/pi-bridge-cli.js';

const code = await main(process.argv.slice(2));
if (code !== undefined) process.exit(code);
