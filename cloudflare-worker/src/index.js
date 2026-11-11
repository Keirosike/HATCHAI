import {alertRepository,dispatchAlert} from './telemetry-alerts.js';
import {cameraCapturesFetch,cleanupCaptures} from './camera-captures.js';

import {cameraEventsFetch,dispatchCamera,cameraRepository} from './camera-events.js';
import { pairingFetch } from './pairing.js';
import { cleanup } from './retention.js';
import { onlineFetch } from './online-api.js';
import {telemetryRepository} from './telemetry.js';
import { telemetryFetch } from './telemetry.js';
import { nativePushFetch } from './native-push.js';
import {deviceApiKeyFetch,deviceRepository} from './device-api-keys.js';

export default {
  async scheduled(_event, env, ctx) {
    if(env.DEVICE_API_KEY_ENROLLMENT_ENABLED==='true'||env.DEVICE_API_KEY_AUTH_ENABLED==='true')ctx.waitUntil(deviceRepository(env)('device_api_key_cleanup',{}));
    if(env.CAMERA_CAPTURES_ENABLED==='true')ctx.waitUntil(cleanupCaptures(env));
    // Propagate failure to the scheduler; never include credentials in log output.
    if(env.CAMERA_EVENTS_ENABLED==='true')ctx.waitUntil(cameraRepository(env)('cleanup').then(()=>dispatchCamera(env)));
    if(env.TELEMETRY_ENABLED==='true'){const repository=telemetryRepository(env);ctx.waitUntil(env.TELEMETRY_ROLLUPS_ENABLED==='true'?repository('finalize',{}).then(()=>repository('cleanup_v2',{})):repository('cleanup',{}));}
    if(env.TELEMETRY_ENABLED==='true'&&env.TELEMETRY_ROLLUPS_ENABLED==='true'&&env.TELEMETRY_ALERTS_ENABLED==='true'){const alerts=alertRepository(env);ctx.waitUntil(alerts('tick').then(()=>alerts('cleanup')).then(()=>dispatchAlert(env)));}
    ctx.waitUntil(cleanup(env).then(counts => {
      if (counts.backlogPossible) console.warn('Pairing cleanup reached work bound', counts);
      else console.info('Pairing cleanup counts', counts);
    }));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if(url.pathname==='/device/enroll'||url.pathname==='/online/device-enrollment')return deviceApiKeyFetch(request,env);
    if(url.pathname==='/device/camera-captures'||/^\/online\/incubators\/[^/]+\/captures(?:\/[^/]+)?$/.test(url.pathname))return cameraCapturesFetch(request,env);
    if(url.pathname==='/device/camera-events'||/^\/online\/incubators\/[^/]+\/camera-events$/.test(url.pathname))return cameraEventsFetch(request,env);
    if(url.pathname==='/device/telemetry'||/^\/online\/incubators\/[^/]+\/telemetry$/.test(url.pathname))return telemetryFetch(request,env,{waitUntil:ctx?.waitUntil?work=>ctx.waitUntil(work):undefined});
    if (url.pathname.startsWith('/online/push/')) return nativePushFetch(request, env);
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
