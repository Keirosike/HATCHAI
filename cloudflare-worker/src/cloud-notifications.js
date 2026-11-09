// Local integration core. No public route is enabled until the real Supabase
// schema, membership model, durable repository and delivery adapter are verified.
import { ApiError, need, verifyDevice } from './security.js';
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const exact = (body, fields) => body && typeof body === 'object' && !Array.isArray(body) &&
  Object.keys(body).length === fields.length && fields.every(key => Object.hasOwn(body, key));
const unavailable = () => new ApiError(503, 'Cloud notification integration unavailable');

export function validateDetection(body, now) {
  need(exact(body, ['cameraId', 'position', 'batchId', 'eventId', 'detectedAt', 'type']));
  need(id(body.cameraId) && id(body.batchId) && typeof body.eventId === 'string' &&
    /^[A-Za-z0-9_-]{20,96}$/.test(body.eventId));
  need(body.position === 'upper' || body.position === 'lower');
  need(body.type === 'chick_detected' && Number.isSafeInteger(body.detectedAt) &&
    body.detectedAt > now - 86400 && body.detectedAt <= now + 60);
  need(new TextEncoder().encode(JSON.stringify(body)).length <= 1024, 413);
  return Object.freeze({ ...body });
}

// Reuses the existing HMAC format, but uses independent camera/gateway keys.
// Browser JWTs and controller pairing credentials cannot authorize this path.
export async function authenticateEventSource(env, body, now) {
  need(exact(body, ['deviceId', 'keyId', 'issuedAt', 'nonce', 'event', 'signature']));
  need(id(body.deviceId) && id(body.keyId) && Number.isSafeInteger(body.issuedAt) &&
    Math.abs(now - body.issuedAt) <= 60 && typeof body.nonce === 'string' &&
    /^[A-Za-z0-9_-]{24,64}$/.test(body.nonce), 401, 'Unauthorized event source');
  let registry;
  try { registry = JSON.parse(env.NOTIFICATION_EVENT_SOURCES || '{}'); } catch { throw unavailable(); }
  const source = Object.hasOwn(registry, body.deviceId) ? registry[body.deviceId] : null;
  need(source?.enabled === true && ['gateway', 'camera'].includes(source.role) &&
    id(source.incubatorId) && Array.isArray(source.cameraIds) && source.cameraIds.length > 0 &&
    source.cameraIds.every(id) && source.cameraIds.includes(body.event?.cameraId), 403, 'Unauthorized event source');
  need(typeof env.NOTIFICATION_EVENT_KEYS === 'string', 503, 'Event authentication unavailable');
  await verifyDevice({ NOTIFICATION_DEVICE_KEYS: env.NOTIFICATION_EVENT_KEYS }, '/chick-detected', body);
  return Object.freeze({ id: body.deviceId, incubatorId: source.incubatorId, role: source.role });
}

export function detectionNotification(event, batchLabel) {
  const placement = event.position === 'upper' ? 'Upper' : 'Lower';
  const label = typeof batchLabel === 'string' ? batchLabel.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '';
  return Object.freeze({ title: 'HATCHAI — Hatched Chick Detected!',
    body: `A hatched chick was detected in the ${placement} Incubation Batch${label ? ` (${label})` : ''}.`,
    // Same-origin fixed destination; never accept arbitrary event-provided URLs.
    url: `https://hatchai-8d34c.web.app/?batch=${encodeURIComponent(event.batchId)}`,
    tag: `hatchai-${event.cameraId}-${event.eventId}` });
}

export function cloudNotificationCore(deps) {
  const { repository, authenticateUser, send, limit, now = () => Math.floor(Date.now() / 1000) } = deps;
  function ready() {
    need(repository && typeof authenticateUser === 'function' && typeof send === 'function' &&
      typeof limit === 'function', 503, 'Cloud notification integration unavailable');
  }
  async function member(authorization, incubatorId) {
    ready();need(id(incubatorId));
    const user = await authenticateUser(authorization);
    need(user && typeof user.id === 'string' && user.id.length <= 128, 401, 'Sign in required');
    need(await repository.isMember(user.id, incubatorId), 403, 'Incubator access denied');
    return user;
  }
  return {
    async register(authorization, body) {
      need(exact(body, ['incubatorId', 'browserId', 'token', 'deviceName']));
      need(id(body.browserId) && typeof body.token === 'string' && body.token.length >= 32 &&
        body.token.length <= 4096 && !/\s/.test(body.token) && typeof body.deviceName === 'string' && body.deviceName.length <= 80);
      const user = await member(authorization, body.incubatorId);
      need(await limit(`phone:${user.id}`), 429, 'Please retry later');
      // Durable unique token + browser owner constraints must reject cross-user
      // takeover atomically. Client userId fields are never accepted.
      const result = await repository.registerPhone({ ...body, userId: user.id, now: now() });
      need(result?.stored === true, result?.conflict ? 409 : 503, 'Registration not confirmed');
      return { registered: true }; // Never return a token.
    },
    async unregister(authorization, body) {
      need(exact(body, ['incubatorId', 'browserId']) && id(body.browserId));
      const user = await member(authorization, body.incubatorId);
      need(await limit(`phone:${user.id}`), 429, 'Please retry later');
      need(await repository.unregisterPhone(user.id, body.incubatorId, body.browserId), 503, 'Removal not confirmed');
      return { registered: false };
    },
    async ingest(env, envelope) {
      ready();need(envelope && typeof envelope === 'object' && !Array.isArray(envelope));
      const time = now();const event = validateDetection(envelope.event, time);
      const source = await authenticateEventSource(env, envelope, time);
      need(await limit(`source:${source.id}`), 429, 'Please retry later');
      // Single database transaction: source revocation, camera/batch ownership,
      // nonce claim, event identity/content hash, per-camera cooldown and outbox.
      // It must NOT be implemented as separate browser-visible REST inserts.
      const result = await repository.acceptEvent({ source, event, nonce: envelope.nonce,
        issuedAt: envelope.issuedAt, now: time });
      need(result && ['accepted', 'duplicate', 'cooldown'].includes(result.status),
        result?.unauthorized ? 403 : result?.conflict ? 409 : 503, 'Event not accepted');
      return { accepted: true, duplicate: result.status === 'duplicate' };
    },
    async deliverOne() {
      ready();const time = now();
      // claimDelivery must atomically lease one user-authorized outbox row,
      // recheck membership and source/camera revocation, cap attempts and age.
      const item = await repository.claimDelivery(time);
      if (!item) return { processed: false };
      need(item.leaseId && item.event && item.token && item.attempt >= 1 && item.attempt <= 3 &&
        item.expiresAt > time, 503, 'Delivery claim invalid');
      let result;
      try { result = await send(item.token, detectionNotification(item.event, item.batchLabel)); }
      catch { result = { outcome: 'unknown' }; }
      const allowed = ['accepted', 'invalid-token', 'retryable', 'unknown', 'failed'];
      if (!allowed.includes(result?.outcome)) result = { outcome: 'unknown' };
      // Only explicit provider temporary rejections are retryable. Timeout or
      // lost response is unknown, terminal by default: no exactly-once claim.
      const retryAt = result.outcome === 'retryable' && item.attempt < 3 ?
        time + Math.min(300, 15 * 2 ** (item.attempt - 1)) : null;
      need(await repository.finishDelivery(item.leaseId, { outcome: result.outcome, retryAt,
        disableToken: result.outcome === 'invalid-token' }), 503, 'Delivery status unconfirmed');
      return { processed: true, accepted: result.outcome === 'accepted', displayConfirmed: false };
    }
  };
}
