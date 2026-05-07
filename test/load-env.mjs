/**
 * Loads `.env.local` then `.env` from the project root via `dotenv`.
 * Does not override variables already present in `process.env`.
 * Precedence: `.env.local` wins over `.env` for the same key.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });
