import { sendConfirmationEmails } from './confirm.js';
import {
  activeTierForDate,
  calculateRegistrationTotalCents,
  deriveRegistrationStatus,
  generatePledgeCode,
} from './_lib/registration.js';
import { enforceRateLimit, getRegisterRateLimiter } from './_lib/rate-limit.js';
import { buildLookupUrlForRegistration } from './_lib/site.js';
import { supabaseRestRequest } from './_lib/supabase.js';
import { serverLog } from './_lib/server-log.js';
import { validateAttendees, validateContact } from './_lib/validation.js';

const MAX_PLEDGE_CODE_ATTEMPTS = 8;

function createRegistrationGate(step, message, extras = {}) {
  return {
    ok: false,
    step,
    message,
    ...extras,
  };
}

function firstContactFocusId(fieldErrors) {
  if (fieldErrors.first_name) return 'fn';
  if (fieldErrors.last_name) return 'ln';
  if (fieldErrors.email) return 'em';
  return 'fn';
}

function isPledgeCodeConflict(response) {
  const message = JSON.stringify(response?.data || '');
  return response?.status === 409 || /pledge_code|23505/i.test(message);
}

async function insertRegistration(registration) {
  for (let attempt = 0; attempt < MAX_PLEDGE_CODE_ATTEMPTS; attempt += 1) {
    const response = await supabaseRestRequest('POST', 'registrations?select=id,created_at,pledge_code,tier,total_cents,amount_paid_cents,status,lookup_token_version', {
      headers: {
        Prefer: 'return=representation',
      },
      body: {
        ...registration,
        pledge_code: generatePledgeCode(),
      },
    });

    if (response.ok && Array.isArray(response.data) && response.data[0]) {
      return response.data[0];
    }

    if (isPledgeCodeConflict(response)) {
      continue;
    }

    throw new Error(
      typeof response.data === 'string'
        ? response.data
        : response.data?.message || 'Could not save registration.'
    );
  }

  throw new Error('Could not create a unique pledge code. Please try again.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rate = await enforceRateLimit(req, getRegisterRateLimiter);
  if (!rate.ok) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { contact, attendees } = req.body || {};
  const validatedContact = validateContact(contact);
  if (!validatedContact.valid) {
    return res.status(400).json(
      createRegistrationGate('contact', 'Please correct your contact information and try again.', {
        focusId: firstContactFocusId(validatedContact.errors),
        fieldErrors: validatedContact.errors,
      })
    );
  }

  const validatedAttendees = validateAttendees(attendees);
  if (!validatedAttendees.valid) {
    return res.status(400).json(
      createRegistrationGate(
        'attendees',
        'Please review each attendee name and age before continuing.',
        {
          attendeeErrors: validatedAttendees.errors,
        }
      )
    );
  }

  const tier = activeTierForDate();
  const totalCents = calculateRegistrationTotalCents(validatedAttendees.normalized, tier);
  const amountPaidCents = 0;
  const status = deriveRegistrationStatus(totalCents, amountPaidCents);

  let persisted;
  try {
    persisted = await insertRegistration({
      first_name: validatedContact.normalized.first_name,
      last_name: validatedContact.normalized.last_name,
      email: validatedContact.normalized.email,
      email_normalized: validatedContact.normalized.email_normalized,
      phone: validatedContact.normalized.phone,
      church: validatedContact.normalized.church,
      city: validatedContact.normalized.city,
      tier,
      total_cents: totalCents,
      amount_paid_cents: amountPaidCents,
      status,
      attendees_json: validatedAttendees.normalized,
      metadata: {
        source: 'public-site',
      },
    });
  } catch (error) {
    serverLog('error', 'register.save_failed', {
      route: '/api/register',
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
    return res.status(500).json({
      error: 'Could not save your registration. Please try again.',
    });
  }

  let emailResult = {
    ok: false,
    confirmSent: false,
    notificationSent: false,
    errors: [],
  };

  const lookupUrl = buildLookupUrlForRegistration(req, persisted);

  try {
    emailResult = await sendConfirmationEmails({
      registration_id: persisted.id,
      first_name: validatedContact.normalized.first_name,
      last_name: validatedContact.normalized.last_name,
      email: validatedContact.normalized.email,
      phone: validatedContact.normalized.phone,
      church: validatedContact.normalized.church,
      pledge_code: persisted.pledge_code,
      tier,
      total_pledged: totalCents / 100,
      amount_paid: 0,
      attendees: validatedAttendees.normalized,
      lookup_url: lookupUrl,
    });
  } catch (error) {
    serverLog('error', 'register.email_failed_after_persist', {
      route: '/api/register',
      registration_id: persisted.id,
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
  }

  serverLog('info', 'register.persisted', {
    route: '/api/register',
    registration_id: persisted.id,
    pledge_code: persisted.pledge_code,
    email_ok: emailResult.confirmSent,
  });

  return res.status(201).json({
    ok: true,
    registration: {
      id: persisted.id,
      created_at: persisted.created_at,
      pledge_code: persisted.pledge_code,
      tier: persisted.tier,
      total_cents: persisted.total_cents,
      total_amount: persisted.total_cents / 100,
      amount_paid_cents: persisted.amount_paid_cents,
      amount_paid: persisted.amount_paid_cents / 100,
      remaining_cents: Math.max(0, persisted.total_cents - persisted.amount_paid_cents),
      remaining_amount: Math.max(0, persisted.total_cents - persisted.amount_paid_cents) / 100,
      status: persisted.status,
      lookup_url: lookupUrl,
    },
    email: {
      confirm_sent: emailResult.confirmSent,
      notification_sent: emailResult.notificationSent,
      has_errors: Array.isArray(emailResult.errors) && emailResult.errors.length > 0,
    },
  });
}
