// Best-effort lookup of this device's own push subscription endpoint, so a
// /api/notify call can ask the server to skip notifying the device that just
// performed the action (see excludeEndpoint in api/notify/route.ts). Never
// throws — resolves to undefined if push isn't supported or not subscribed,
// so callers can fire-and-forget without extra error handling.
export async function getOwnPushEndpoint(): Promise<string | undefined> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return undefined
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub?.endpoint
  } catch {
    return undefined
  }
}
