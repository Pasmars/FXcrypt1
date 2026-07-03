// notify.js — FCM web-push delivery to a user's registered devices.
//
// Device tokens live at users/{uid}/devices/{id} → { token, ua, createdAt }.
// Per-category mute prefs live on users/{uid}.notifyPrefs — absent = enabled.
// Categories: 'trades' (fills/exits), 'gems' (auto-buys/alerts), 'signals',
// 'system'. Muted categories are dropped HERE, server-side, so a stale client
// can never leak a muted notification.
//
// `link` is an app path (e.g. '/?goto=portfolio') resolved by each app's
// service worker against its own origin — one payload serves both the mobile
// PWA and the webapp.

async function send(db, admin, uid, { category = 'system', title, body, link = '/', tag } = {}) {
  if (!title) return { sent: 0 }
  try {
    const userSnap = await db.doc(`users/${uid}`).get()
    const prefs = (userSnap.exists && userSnap.data().notifyPrefs) || {}
    if (prefs[category] === false) return { sent: 0, muted: true }

    const devSnap = await db.collection(`users/${uid}/devices`).limit(10).get()
    const tokens = devSnap.docs.map((d) => ({ ref: d.ref, token: d.data().token })).filter((d) => d.token)
    if (!tokens.length) return { sent: 0 }

    const res = await admin.messaging().sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title: String(title).slice(0, 120), body: String(body || '').slice(0, 300) },
      data: { category, link },
      webpush: {
        headers: { Urgency: 'high' },
        notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', ...(tag ? { tag } : {}) },
      },
    })

    // Prune tokens FCM reports as dead so the registry never accumulates cruft.
    const prunes = []
    res.responses.forEach((r, i) => {
      const code = r.error && r.error.code
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
        prunes.push(tokens[i].ref.delete().catch(() => {}))
      }
    })
    if (prunes.length) await Promise.all(prunes)
    return { sent: res.successCount, pruned: prunes.length }
  } catch (e) {
    console.warn(`notify(${uid}) failed:`, e.message)
    return { sent: 0, error: e.message }
  }
}

module.exports = { send }
