import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveEmailTransport,
  resolveMailpitSmtpPort,
} from '../../api/_lib/email-send.js';

function restore(name, prev) {
  if (prev === undefined) delete process.env[name];
  else process.env[name] = prev;
}

test('resolveMailpitSmtpPort respects SMTP_PORT over MAILPIT_SMTP_PORT', () => {
  const prevSp = process.env.SMTP_PORT;
  const prevMp = process.env.MAILPIT_SMTP_PORT;
  const prevUrl = process.env.SUPABASE_URL;
  process.env.SMTP_PORT = '465';
  process.env.MAILPIT_SMTP_PORT = '3111';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  try {
    assert.equal(resolveMailpitSmtpPort(), 465);
  } finally {
    restore('SMTP_PORT', prevSp);
    restore('MAILPIT_SMTP_PORT', prevMp);
    restore('SUPABASE_URL', prevUrl);
  }
});

test('resolveMailpitSmtpPort is 587 when SMTP_HOST set and no port env', () => {
  const prevHost = process.env.SMTP_HOST;
  const prevSp = process.env.SMTP_PORT;
  const prevMp = process.env.MAILPIT_SMTP_PORT;
  const prevUrl = process.env.SUPABASE_URL;
  process.env.SMTP_HOST = 'smtpout.secureserver.net';
  delete process.env.SMTP_PORT;
  delete process.env.MAILPIT_SMTP_PORT;
  process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';
  try {
    assert.equal(resolveMailpitSmtpPort(), 587);
  } finally {
    restore('SMTP_HOST', prevHost);
    restore('SMTP_PORT', prevSp);
    restore('MAILPIT_SMTP_PORT', prevMp);
    restore('SUPABASE_URL', prevUrl);
  }
});

test('resolveMailpitSmtpPort respects MAILPIT_SMTP_PORT', () => {
  const prevPort = process.env.MAILPIT_SMTP_PORT;
  const prevUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.MAILPIT_SMTP_PORT = '3111';
  try {
    assert.equal(resolveMailpitSmtpPort(), 3111);
  } finally {
    restore('MAILPIT_SMTP_PORT', prevPort);
    restore('SUPABASE_URL', prevUrl);
  }
});

test('resolveMailpitSmtpPort is 54325 for local Supabase API URL (127.0.0.1)', () => {
  const prevPort = process.env.MAILPIT_SMTP_PORT;
  const prevUrl = process.env.SUPABASE_URL;
  delete process.env.MAILPIT_SMTP_PORT;
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  try {
    assert.equal(resolveMailpitSmtpPort(), 54325);
  } finally {
    restore('MAILPIT_SMTP_PORT', prevPort);
    restore('SUPABASE_URL', prevUrl);
  }
});

test('resolveMailpitSmtpPort is 54325 for local Supabase API URL (localhost)', () => {
  const prevPort = process.env.MAILPIT_SMTP_PORT;
  const prevUrl = process.env.SUPABASE_URL;
  delete process.env.MAILPIT_SMTP_PORT;
  process.env.SUPABASE_URL = 'http://localhost:54321';
  try {
    assert.equal(resolveMailpitSmtpPort(), 54325);
  } finally {
    restore('MAILPIT_SMTP_PORT', prevPort);
    restore('SUPABASE_URL', prevUrl);
  }
});

test('resolveMailpitSmtpPort is 1025 for hosted Supabase', () => {
  const prevPort = process.env.MAILPIT_SMTP_PORT;
  const prevUrl = process.env.SUPABASE_URL;
  delete process.env.MAILPIT_SMTP_PORT;
  process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';
  try {
    assert.equal(resolveMailpitSmtpPort(), 1025);
  } finally {
    restore('MAILPIT_SMTP_PORT', prevPort);
    restore('SUPABASE_URL', prevUrl);
  }
});

test('resolveEmailTransport uses Resend when RESEND_API_KEY set outside test', () => {
  const snap = [
    'EMAIL_TRANSPORT',
    'VERCEL_ENV',
    'RESEND_API_KEY',
    'NODE_ENV',
  ].map((k) => [k, process.env[k]]);
  delete process.env.EMAIL_TRANSPORT;
  delete process.env.VERCEL_ENV;
  process.env.RESEND_API_KEY = 're_local_dev';
  process.env.NODE_ENV = 'development';
  try {
    assert.equal(resolveEmailTransport(), 'resend');
  } finally {
    for (const [k, v] of snap) {
      restore(k, v);
    }
  }
});

test('resolveEmailTransport stays smtp in NODE_ENV=test even with RESEND_API_KEY', () => {
  const snap = [
    'EMAIL_TRANSPORT',
    'VERCEL_ENV',
    'RESEND_API_KEY',
    'NODE_ENV',
  ].map((k) => [k, process.env[k]]);
  delete process.env.EMAIL_TRANSPORT;
  delete process.env.VERCEL_ENV;
  process.env.RESEND_API_KEY = 're_test';
  process.env.NODE_ENV = 'test';
  try {
    assert.equal(resolveEmailTransport(), 'smtp');
  } finally {
    for (const [k, v] of snap) {
      restore(k, v);
    }
  }
});

test('resolveEmailTransport respects explicit EMAIL_TRANSPORT=smtp with RESEND_API_KEY', () => {
  const snap = [
    'EMAIL_TRANSPORT',
    'VERCEL_ENV',
    'RESEND_API_KEY',
    'NODE_ENV',
  ].map((k) => [k, process.env[k]]);
  process.env.EMAIL_TRANSPORT = 'smtp';
  delete process.env.VERCEL_ENV;
  process.env.RESEND_API_KEY = 're_local_dev';
  process.env.NODE_ENV = 'development';
  try {
    assert.equal(resolveEmailTransport(), 'smtp');
  } finally {
    for (const [k, v] of snap) {
      restore(k, v);
    }
  }
});
