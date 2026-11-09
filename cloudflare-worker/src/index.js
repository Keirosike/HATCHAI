
import { pairingFetch } from './pairing.js';
import { cleanup } from './retention.js';
import { onlineFetch } from './online-api.js';

export default {
  async scheduled(_event, env, ctx) {
    // Propagate failure to the scheduler; never include credentials in log output.
    ctx.waitUntil(cleanup(env).then(counts => {
      if (counts.backlogPossible) console.warn('Pairing cleanup reached work bound', counts);
      else console.info('Pairing cleanup counts', counts);
    }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/online/incubators') return onlineFetch(request, env);

    const json = (data, status = 200) =>
      Response.json(data, {
        status,
        headers: {
          'Cache-Control': 'no-store'
        }
      });

    if (request.method === 'GET' && url.pathname === '/') {
      return json({
        application: 'HATCHAI',
        service: 'Push Notification API',
        status: 'online',
        firebaseProject: 'hatchai-8d34c'
      });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      try {
        const result = await env.DB.prepare(
          'SELECT COUNT(*) AS total FROM push_tokens WHERE enabled = 1'
        ).first();

        return json({
          status: 'ok',
          database: 'connected',
          registeredDevices: result.total
        });
      } catch (error) {
        // Do not log database errors or token-bearing query details.
        return json({
          status: 'error',
          database: 'unavailable'
        }, 503);
      }
    }

    if (request.method === 'POST' && url.pathname === '/register') {
      return pairingFetch(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/chick-detected') {
      return json({
        success: false,
        message: 'Authenticated detection delivery is pending.'
      }, 503);
    }

    return pairingFetch(request, env);
  }
};
