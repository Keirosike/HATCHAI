
importScripts(
  "https://www.gstatic.com/firebasejs/13.2.0/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging-compat.js"
);

const firebaseConfig = {
  apiKey: "AIzaSyAGWCW9p4H8u0OfLvIMbUKqGk1hKb6nGRk",
  authDomain: "hatchai-8d34c.firebaseapp.com",
  projectId: "hatchai-8d34c",
  storageBucket: "hatchai-8d34c.firebasestorage.app",
  messagingSenderId: "935024796827",
  appId: "1:935024796827:web:93aad7f809d19eabe2523e"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Handle messages received while HATCHAI is in the background.
messaging.onBackgroundMessage((payload) => {
  console.log("HATCHAI background message:", payload);

  // Notification messages are automatically displayed
  // by Firebase Messaging in the background.
  if (payload.notification) {
    return;
  }

  // Handle data-only messages manually.
  const title =
    payload.data?.title || "HATCHAI — Chick Hatched!";

  const options = {
    body:
      payload.data?.body ||
      "A newly hatched chick has been detected inside your incubator.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: "hatchai-chick-detected",
    renotify: true,
    data: {
      url: payload.data?.url || "/"
    }
  };

  return self.registration.showNotification(title, options);
});

// Handle notification clicks.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "/",
    self.location.origin
  ).href;

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) &&
            "focus" in client) {
          return client.focus();
        }
      }

      return clients.openWindow(targetUrl);
    })
  );
});
