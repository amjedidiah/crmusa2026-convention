const DEFAULT_CLIENT_APP_URL =
  "https://www.crm-na.org/events/crm-usa-national-convention-2026";
const RETURN_TO_STORAGE_KEY = "crm-na-client-app-return-to";

function normalizeReturnTo(raw) {
  if (!raw) return null;

  try {
    const url = new URL(raw, globalThis.location.origin);
    const host = url.hostname.toLowerCase();
    const isAllowedHost =
      host === "crm-na.org" ||
      host === "www.crm-na.org" ||
      host === "localhost" ||
      host === "127.0.0.1";

    if (!isAllowedHost) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    return url.toString();
  } catch {
    return null;
  }
}

function readStoredReturnTo() {
  try {
    return normalizeReturnTo(
      globalThis.sessionStorage.getItem(RETURN_TO_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function writeStoredReturnTo(returnTo) {
  try {
    globalThis.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, returnTo);
  } catch {
    // Ignore storage failures in private mode.
  }
}

function getClientAppReturnTo() {
  const fromQuery = normalizeReturnTo(
    new URLSearchParams(globalThis.location.search).get("returnTo"),
  );

  if (fromQuery) {
    writeStoredReturnTo(fromQuery);
    return fromQuery;
  }

  return readStoredReturnTo() || DEFAULT_CLIENT_APP_URL;
}

function withReturnTo(href, returnTo) {
  try {
    const url = new URL(href, globalThis.location.href);

    if (url.origin !== globalThis.location.origin) {
      return url.toString();
    }

    url.searchParams.set("returnTo", returnTo);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

function applyClientAppLinks() {
  const returnTo = getClientAppReturnTo();

  document.querySelectorAll("[data-client-app-link]").forEach((link) => {
    link.setAttribute("href", returnTo);
  });

  document.querySelectorAll("[data-preserve-return-to]").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;
    link.setAttribute("href", withReturnTo(href, returnTo));
  });
}

globalThis.crmConventionShell = {
  applyClientAppLinks,
  getClientAppReturnTo,
  withReturnTo,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyClientAppLinks, {
    once: true,
  });
} else {
  applyClientAppLinks();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failure should not block registration or lookup flows.
    });
  });
}
