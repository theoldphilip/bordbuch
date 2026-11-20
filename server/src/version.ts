/**
 * Version of the app, from the VERSION file in the repository root (the single source: server, web app and
 * image all read it). In the Docker image the file is /app/VERSION, in the repository it is two levels
 * above this file, so the same relative path works in both places.
 * The build time is written into /app/BUILD_TIME while the image is built.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export const VERSION: string = process.env.APP_VERSION?.trim() || readText(path.join(root, 'VERSION')) || '0.0.0-dev';
/** ISO time the Docker image was built; null when running from the repository. */
export const BUILT_AT: string | null = process.env.BUILD_TIME?.trim() || readText(path.join(root, 'BUILD_TIME'));
