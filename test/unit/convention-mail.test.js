import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isConventionMailEnvStrict,
  isVercelProduction,
} from '../../api/_lib/convention-mail.js';

function restoreEnv(snap) {
  for (const [k, v] of snap) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test('isVercelProduction is true only for VERCEL_ENV=production', () => {
  const snap = ['VERCEL_ENV', 'NODE_ENV', 'VERCEL'].map((k) => [k, process.env[k]]);
  try {
    delete process.env.VERCEL_ENV;
    assert.equal(isVercelProduction(), false);
    process.env.VERCEL_ENV = 'preview';
    assert.equal(isVercelProduction(), false);
    process.env.VERCEL_ENV = 'production';
    assert.equal(isVercelProduction(), true);
  } finally {
    restoreEnv(snap);
  }
});

test('isConventionMailEnvStrict: Vercel production', () => {
  const snap = ['VERCEL_ENV', 'NODE_ENV', 'VERCEL'].map((k) => [k, process.env[k]]);
  try {
    process.env.VERCEL_ENV = 'production';
    process.env.NODE_ENV = 'development';
    process.env.VERCEL = '1';
    assert.equal(isConventionMailEnvStrict(), true);
  } finally {
    restoreEnv(snap);
  }
});

test('isConventionMailEnvStrict: non-Vercel Node production', () => {
  const snap = ['VERCEL_ENV', 'NODE_ENV', 'VERCEL'].map((k) => [k, process.env[k]]);
  try {
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    assert.equal(isConventionMailEnvStrict(), true);
  } finally {
    restoreEnv(snap);
  }
});

test('isConventionMailEnvStrict: Vercel preview uses NODE_ENV production but not strict by NODE alone', () => {
  const snap = ['VERCEL_ENV', 'NODE_ENV', 'VERCEL'].map((k) => [k, process.env[k]]);
  try {
    process.env.VERCEL_ENV = 'preview';
    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    assert.equal(isConventionMailEnvStrict(), false);
  } finally {
    restoreEnv(snap);
  }
});

test('isConventionMailEnvStrict: development is not strict', () => {
  const snap = ['VERCEL_ENV', 'NODE_ENV', 'VERCEL'].map((k) => [k, process.env[k]]);
  try {
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL;
    assert.equal(isConventionMailEnvStrict(), false);
  } finally {
    restoreEnv(snap);
  }
});
