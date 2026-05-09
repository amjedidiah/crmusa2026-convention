import { validate as deepValidateEmail } from 'deep-email-validator';

import { normalizeEmail, normalizePhoneForDedup } from './registration.js';
import { serverLog } from './server-log.js';

export function isBlank(value) {
  return String(value || '').trim() === '';
}

export function validateContact(contact) {
  const candidate = contact || {};
  const errors = {};

  if (isBlank(candidate.first_name)) errors.first_name = 'First name is required.';
  if (isBlank(candidate.last_name)) errors.last_name = 'Last name is required.';

  const email = normalizeEmail(candidate.email);
  if (!email) {
    errors.email = 'Email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Email must be valid.';
  }

  const phone = String(candidate.phone || '').trim();

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized: {
      first_name: String(candidate.first_name || '').trim(),
      last_name: String(candidate.last_name || '').trim(),
      email_raw: String(candidate.email || '').trim(),
      email,
      email_normalized: email,
      phone,
      phone_normalized: normalizePhoneForDedup(phone),
      church: String(candidate.church || '').trim(),
      city: String(candidate.city || '').trim(),
    },
  };
}

const DISPOSABLE_EMAIL_MESSAGE =
  'Please use a permanent email address so we can send your pledge code, payment updates, and reminder emails.';

export async function validateRegistrationContact(contact) {
  const base = validateContact(contact);
  if (!base.valid) return base;

  try {
    const result = await deepValidateEmail({
      email: base.normalized.email,
      validateRegex: true,
      validateDisposable: true,
      validateTypo: false,
      validateMx: false,
      validateSMTP: false,
    });

    if (!result.valid && result.reason === 'disposable') {
      return {
        ...base,
        valid: false,
        errors: {
          ...base.errors,
          email: DISPOSABLE_EMAIL_MESSAGE,
        },
      };
    }

    return base;
  } catch (error) {
    serverLog('warn', 'register.email_validation_soft_failed', {
      route: 'validation.validateRegistrationContact',
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
    return base;
  }
}

export function validateAttendees(attendees) {
  const rows = Array.isArray(attendees) ? attendees : [];
  const errors = [];
  const normalized = rows.map((attendee, index) => {
    const candidate = attendee || {};
    const name = String(candidate.name || '').trim();
    const ageRaw = candidate.age;
    const age = Number(ageRaw);
    const ageAbsent = ageRaw == null || String(ageRaw).trim() === "";
    const rowErrors = {};

    if (!name) rowErrors.name = 'Attendee name is required.';
    if (ageAbsent || !Number.isInteger(age) || age < 0 || age > 120) {
      rowErrors.age = "Attendee age must be an integer between 0 and 120.";
    }

    if (Object.keys(rowErrors).length > 0) {
      errors.push({ index, errors: rowErrors });
    }

    return {
      name,
      age: Number.isFinite(age) ? age : candidate.age,
    };
  });

  if (normalized.length === 0) {
    errors.push({ index: -1, errors: { attendees: 'At least one attendee is required.' } });
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  };
}
