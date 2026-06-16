import { NextResponse } from 'next/server'

// Served as /sw — registered with scope '/' via Service-Worker-Allowed header.
// Kept as a route (not public/sw.js) so Next.js dev HMR never injects into it.
const SW = `
self.addEventListener('push', function(event) {
  if (!event.data) return;
  var data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:    '/apple-icon.png',
      vibrate: [200, 100, 200],
      data:  { url: data.url || '/receipts' }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/receipts';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      // If app is already open, navigate it to the target URL then focus
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('navigate' in c) {
          return c.navigate(target).then(function(w) { return w ? w.focus() : null; });
        }
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(target);
    })
  );
});
`

export async function GET() {
  return new NextResponse(SW, {
    headers: {
      'Content-Type':          'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/',
      'Cache-Control':          'no-cache',
    },
  })
}
