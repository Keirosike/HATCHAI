// Retry-After is a lower bound, not a duration to clamp down to our backoff cap.
// Return null for valid but unrepresentably long waits: never retry them early.
// Invalid/missing values use the normal bounded fallback; no raw value is logged.
export function retryAfterMs(value, nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  const fallback = 30000;
  if (value == null) return fallback;
  const text = value.trim();
  if (text.length > 128) return null;
  if (/^\d+$/.test(text)) {
    if (text.length > 32) return null;
    const delay = BigInt(text) * 1000n;
    if (delay > BigInt(Number.MAX_SAFE_INTEGER - nowMs)) return null;
    return Math.max(1000, Number(delay));
  }
  // HTTP-date accepts IMF-fixdate plus the two historical RFC9110 formats.
  // Normalize only recognized syntax; a UTC roundtrip rejects rollover dates
  // and mismatched weekdays. Never pass arbitrary strings to Date.parse().
  let canonical=text;
  const obsolete=/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(text);
  if(obsolete){
    const yearNow=new Date(nowMs).getUTCFullYear();let year=Math.floor(yearNow/100)*100+Number(obsolete[4]);
    if(year>yearNow+50)year-=100;
    canonical=`${obsolete[1].slice(0,3)}, ${obsolete[2]} ${obsolete[3]} ${String(year).padStart(4,'0')} ${obsolete[5]} GMT`;
  }
  const asctime=/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/.exec(text);
  if(asctime)canonical=`${asctime[1]}, ${asctime[3].trim().padStart(2,'0')} ${asctime[2]} ${asctime[5]} ${asctime[4]} GMT`;
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(canonical)) {
    const date = Date.parse(canonical);
    if (Number.isSafeInteger(date) && new Date(date).toUTCString() === canonical) return Math.max(1000, date - nowMs);
  }
  return fallback;
}

// No sleeping/timers. A future durable outbox stores this absolute deadline.
// If the provider wait cannot fit the event lifetime, finish without another send.
export function retryDeadline(result, item, nowMs) {
  if (result.outcome !== 'retryable' || !Number.isInteger(item.attempt) || item.attempt < 1 || item.attempt >= 3 || !Number.isSafeInteger(nowMs) || nowMs<0 || !Number.isSafeInteger(item.expiresAt)) return null;
  const delay = result.retryAfterMs ?? 30000;
  if (!Number.isSafeInteger(delay) || delay < 0 || !Number.isSafeInteger(nowMs + delay)) return null;
  const provider = result.retryNotBefore ?? nowMs + delay;
  if (!Number.isSafeInteger(provider) || provider < 0) return null;
  const backoff = nowMs + 15000 * 2 ** (item.attempt - 1);
  const deadline = Math.max(backoff, provider);
  return Number.isSafeInteger(deadline) && deadline < item.expiresAt ? deadline : null;
}
