
import { getHatchaiMessaging } from './firebase-config.js';
import { vapidKey } from './push-settings.js';

import {
  getToken,
  deleteToken,
  onMessage
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging.js';

// ======================================
// HATCHAI INITIALIZATION
// ======================================

const status = document.getElementById('status');
const enableButton = document.getElementById('enable');
const disableButton = document.getElementById('disable');

const DISABLED_KEY = 'hatchaiPushDisabled';
const TOKEN_KEY = 'hatchaiPushToken';

let busy = false;
let swRegistration = null;
let registrationPromise = null;

// ======================================
// STATUS
// ======================================

function setStatus(message) {
  if (status) {
    status.textContent = message;
  }

  console.log('HATCHAI:', message);
}

// ======================================
// ACTION HANDLER
// ======================================

async function action(work) {
  if (busy) return;

  busy = true;

  if (enableButton) enableButton.disabled = true;
  if (disableButton) disableButton.disabled = true;

  try {
    await work();
  } catch (error) {
    console.error('HATCHAI error:', error);
    setStatus(error.message || 'An unexpected error occurred.');
  } finally {
    busy = false;

    if (enableButton) enableButton.disabled = false;
    if (disableButton) disableButton.disabled = false;
  }
}

// ======================================
// CHECK WEB PUSH SUPPORT
// ======================================

function checkPushSupport() {
  if (!vapidKey) {
    throw new Error('Missing VAPID key.');
  }

  if (!window.isSecureContext) {
    throw new Error('HTTPS is required.');
  }

  if (
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    throw new Error('Web push is not supported.');
  }
}

// ======================================
// REGISTER SERVICE WORKER
// ======================================

async function registerHatchaiServiceWorker() {
  if (swRegistration?.active) {
    return swRegistration;
  }

  if (registrationPromise) {
    return registrationPromise;
  }

  registrationPromise = (async () => {
    await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
      { scope: '/' }
    );

    const registration =
      await navigator.serviceWorker.ready;

    if (!registration.active) {
      throw new Error('HATCHAI service worker is not active.');
    }

    swRegistration = registration;

    console.log(
      'HATCHAI service worker:',
      registration.scope,
      registration.active.state
    );

    return registration;
  })();

  try {
    return await registrationPromise;
  } finally {
    registrationPromise = null;
  }
}

// ======================================
// GENERATE OR REFRESH FCM TOKEN
// ======================================

async function registerPushToken() {
  checkPushSupport();

  if (Notification.permission !== 'granted') {
    throw new Error('Notification permission is not granted.');
  }

  const registration =
    await registerHatchaiServiceWorker();

  const messaging = await getHatchaiMessaging();

  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration
  });

  if (!token) {
    throw new Error('FCM token generation failed.');
  }

  // Temporary browser-side storage only.
  // This does not register the token with a backend.
  localStorage.setItem(TOKEN_KEY, token);

  console.log('HATCHAI FCM token registered successfully.');
  console.log('HATCHAI SW scope:', registration.scope);

  return token;
}

// ======================================
// AUTOMATIC FCM TOKEN REGISTRATION
// ======================================

async function autoRegisterPush() {
  // Respect the user's choice to disable notifications.
  if (localStorage.getItem(DISABLED_KEY) === 'true') {
    setStatus('HATCHAI notifications are disabled.');
    return;
  }

  if (
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  ) {
    setStatus(
      'Click Enable Notifications to allow HATCHAI alerts.'
    );
    return;
  }

  await action(async () => {
    await registerPushToken();

    setStatus(
      'HATCHAI notifications automatically registered.'
    );

    console.log(
      'HATCHAI automatic FCM registration successful.'
    );
  });
}

// ======================================
// ENABLE PUSH NOTIFICATIONS
// ======================================

if (enableButton) {
  enableButton.addEventListener('click', () => {
    action(async () => {
      checkPushSupport();

      // The permission request follows a user click.
      const permission =
        await Notification.requestPermission();

      if (permission !== 'granted') {
        throw new Error(
          'Notification permission was not granted.'
        );
      }

      await registerPushToken();

      // Clear the disabled flag only after success.
      localStorage.removeItem(DISABLED_KEY);

      setStatus(
        'Notifications enabled! Automatic registration is active.'
      );
    });
  });
}

// ======================================
// DISABLE PUSH NOTIFICATIONS
// ======================================

if (disableButton) {
  disableButton.addEventListener('click', () => {
    action(async () => {
      // Prevent automatic re-registration.
      localStorage.setItem(DISABLED_KEY, 'true');

      const messaging = await getHatchaiMessaging();

      await deleteToken(messaging);

      localStorage.removeItem(TOKEN_KEY);

      setStatus('Push notifications disabled.');
    });
  });
}

// ======================================
// FOREGROUND FCM NOTIFICATIONS
// ======================================

getHatchaiMessaging()
  .then(messaging => {
    onMessage(messaging, async payload => {
      console.log('HATCHAI FCM message:', payload);

      const title =
        payload.notification?.title ||
        payload.data?.title ||
        'HATCHAI — Chick Hatched!';

      const body =
        payload.notification?.body ||
        payload.data?.body ||
        'A newly hatched chick has been detected inside your incubator.';

      setStatus(title + ': ' + body);

      try {
        if (Notification.permission === 'granted') {
          const registration =
            swRegistration ||
            await registerHatchaiServiceWorker();

          await registration.showNotification(title, {
            body,
            tag: 'hatchai-chick-detected',
            renotify: true,
            data: {
              url: '/'
            }
          });

          console.log(
            'HATCHAI foreground notification requested.'
          );
        }
      } catch (error) {
        console.error(
          'Foreground notification error:',
          error
        );
      }
    });
  })
  .catch(error => {
    console.warn(
      'Firebase Messaging initialization:',
      error.message
    );
  });

// ======================================
// AUTOMATIC INITIALIZATION
// ======================================

// Automatically retrieve the FCM token when the
// website opens and permission was already granted.
// No Firebase sign-in is required.

autoRegisterPush();
