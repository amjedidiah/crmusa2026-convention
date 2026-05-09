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
import { validateAttendees, validateRegistrationContact } from './_lib/validation.js';

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
  if (fieldErrors.phone) return 'ph';
  return 'fn';
}

const DUPLICATE_EMAIL_MESSAGE =
  "This email already has a registration. If you need your pledge code, use Find registration from the site. If you are registering someone else separately, use a different email or contact info@crm-na.org.";

const DUPLICATE_PHONE_MESSAGE =
  "This phone number is already tied to a registration. If several households share one line, use a different number on this form or contact info@crm-na.org.";

function duplicateRegistrationError(field) {
  const err = new Error('duplicate_registration');
  err.duplicateField = field;
  return err;
}

function isPledgeCodeConflict(response) {
  if (response?.status !== 409) return false;
  const message = JSON.stringify(response?.data || '');
  return /pledge_code|registrations_pledge_code/i.test(message);
}

/** PostgREST 409 body mentions the violated unique index / column. */
function duplicateRegistrationFieldFromResponse(response) {
  if (response?.status !== 409) return null;
  const message = JSON.stringify(response?.data || '');
  if (/email_normalized/i.test(message)) return 'email';
  if (/phone_normalized/i.test(message)) return 'phone';
  return null;
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

    const dupField = duplicateRegistrationFieldFromResponse(response);
    if (dupField) {
      throw duplicateRegistrationError(dupField);
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

  const { contact, attendees, payment_intent_cents: rawPaymentIntent } = req.body || {};
  const validatedContact = await validateRegistrationContact(contact);
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

  let paymentIntentCents = 0;
  if (rawPaymentIntent !== undefined && rawPaymentIntent !== null && rawPaymentIntent !== '') {
    const n = Number(rawPaymentIntent);
    if (!Number.isInteger(n) || n < 0) {
      return res
        .status(400)
        .json(
          createRegistrationGate(
            "payment",
            "Enter a valid payment amount on the submit step, or contact info@crm-na.org.",
          ),
        );
    }
    paymentIntentCents = n;
  }

  if (totalCents === 0) {
    if (paymentIntentCents !== 0) {
      return res.status(400).json(
        createRegistrationGate('payment', 'This registration is free; remove any payment amount and try again.')
      );
    }
  } else if (paymentIntentCents > totalCents) {
    return res.status(400).json(
      createRegistrationGate(
        'payment',
        'The amount you plan to pay today cannot exceed your registration total. Adjust the amount and try again.'
      )
    );
  }

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
      phone_normalized: validatedContact.normalized.phone_normalized,
      church: validatedContact.normalized.church,
      city: validatedContact.normalized.city,
      tier,
      total_cents: totalCents,
      amount_paid_cents: amountPaidCents,
      status,
      attendees_json: validatedAttendees.normalized,
      metadata: {
        source: 'public-site',
        ...(totalCents > 0
          ? {
              payment_intent_cents: paymentIntentCents,
              payment_intent_submitted_at: new Date().toISOString(),
            }
          : {}),
      },
    });
  } catch (error) {
    const dupField = error && typeof error.duplicateField === 'string' ? error.duplicateField : null;
    if (dupField === 'email' || dupField === 'phone') {
      const message = dupField === 'email' ? DUPLICATE_EMAIL_MESSAGE : DUPLICATE_PHONE_MESSAGE;
      return res.status(400).json(
        createRegistrationGate('contact', message, {
          focusId: dupField === 'email' ? 'em' : 'ph',
          fieldErrors: { [dupField]: message },
        }),
      );
    }
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
      payment_intent_cents: totalCents > 0 ? paymentIntentCents : 0,
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
