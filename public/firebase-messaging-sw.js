
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
  // Notification messages are automatically displayed
  // by Firebase Messaging in the background.
  if (payload.notification) {
    return;
  }

  // Display only explicit manual-test data messages. Camera delivery stays disabled.
  if (payload.data?.type !== "hatchai-manual-test") return;
  const title = "HATCHAI Test Notification";

  const options = {
    body: "Your HATCHAI notification system is working.",
    tag: "hatchai-manual-test",
    data: {
      url: "/"
    }
  };

  return self.registration.showNotification(title, options);
});

// Handle notification clicks.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const requestedUrl = new URL(
    event.notification.data?.url || "/",
    self.location.origin
  );
  const targetUrl = requestedUrl.origin === self.location.origin ? requestedUrl.href : self.location.origin + "/";

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
