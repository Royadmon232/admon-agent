export async function safeCall(fn, { fallback, retries = 1 }) {
  try {
    return await fn();
  } catch (e) {
    if (retries > 0) return safeCall(fn, { fallback, retries: 0 });
    return typeof fallback === "function" ? fallback(e) : (fallback ?? null);
  }
} 