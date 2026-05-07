import { sendConfirmationEmails } from './confirm.js';
import {
  activeTierForDate,
  calculateRegistrationTotalCents,
  deriveRegistrationStatus,
  generatePledgeCode,
} from './_lib/registration.js';
import { supabaseRestRequest } from './_lib/supabase.js';
import { createLookupToken } from './_lib/tokens.js';
import { validateAttendees, validateContact } from './_lib/validation.js';

const MAX_PLEDGE_CODE_ATTEMPTS = 8;

function getRequestOrigin(req) {
  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/+$/, '');
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    forwardedProto ||
    (req.headers.host && req.headers.host.includes('localhost') ? 'http' : 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  if (!host) {
    return null;
  }

  return `${proto}://${host}`;
}

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

function buildLookupUrl(req, registration) {
  const origin = getRequestOrigin(req);
  if (!origin || !process.env.LOOKUP_TOKEN_SECRET) {
    return null;
  }

  const token = createLookupToken({
    registration_id: registration.id,
    lookup_token_version: registration.lookup_token_version,
  });

  return `${origin}/#return?token=${encodeURIComponent(token)}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
    console.error('[register] Save failed:', error);
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

  try {
    emailResult = await sendConfirmationEmails({
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
    });
  } catch (error) {
    console.error('[register] Email failed after persistence:', error);
  }

  const lookupUrl = buildLookupUrl(req, persisted);

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
      errors: Array.isArray(emailResult.errors) ? emailResult.errors : [],
    },
  });
}
