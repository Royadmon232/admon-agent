/**
 * Wraps a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds (default: 20000)
 * @returns {Promise} The wrapped promise that will reject on timeout
 */
export function withTimeout(promise, ms = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("LLM timeout")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
} 