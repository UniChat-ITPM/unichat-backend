import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

/**
 * Load `unichat-backend/.env` before Nest bootstraps so `*_SERVICE_PORT` and DB URLs exist.
 * Resolves from both `dist/<service>/` (webpack) and `process.cwd()` (Nx CLI).
 */
export function loadWorkspaceEnv(): void {
  const candidates = [
    resolve(__dirname, '../../.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      config({ path: p });
      return;
    }
  }
}
