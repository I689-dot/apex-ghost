// Copies the Basis Universal transcoder (needed by KTX2Loader) into public/libs.
import { cpSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const three = realpathSync(path.resolve(here, '../node_modules/three'));
const dst = path.resolve(here, '../public/libs/basis');
mkdirSync(dst, { recursive: true });
cpSync(path.join(three, 'examples/jsm/libs/basis'), dst, { recursive: true });
console.log('copied basis transcoder →', dst);
