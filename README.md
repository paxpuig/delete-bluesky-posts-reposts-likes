# delete-bluesky-posts-reposts-likes
JS snippet to run in the browser console to delete your Bluesky posts, reposts and/or likes.

> ⚠️ **These scripts permanently delete your content. Deletions cannot be undone. Always do a dry run first.**

---

## Table of Contents

- [Overview](#overview)
- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Scripts](#scripts)
  - [1. Delete all posts](#1-delete-all-posts)
  - [2. Remove all likes and reposts](#2-remove-all-likes-and-reposts)
- [Usage](#usage)
- [Configuration options](#configuration-options)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Disclaimer](#disclaimer)

---

## Overview

This project provides two standalone JavaScript snippets that you can paste directly into your browser's DevTools console while logged into [bsky.app](https://bsky.app). No installation, no dependencies, no third-party app access required.

| Script | What it removes |
|---|---|
| **Delete posts** | All of your posts (including replies you wrote) |
| **Remove likes & reposts** | All of your likes (❤️) and/or reposts (🔁) |

---

## How it works

When you are logged into [bsky.app](https://bsky.app), your auth session (user DID and access token) is stored in the browser's `localStorage`. The scripts read that session automatically — no need to enter your password or generate an API key manually.

They then use the [AT Protocol](https://atproto.com) XRPC API to:

1. Paginate through all records in the relevant collection (`app.bsky.feed.post`, `app.bsky.feed.like`, `app.bsky.feed.repost`).
2. Delete each record one by one, with a small delay between calls to respect rate limits.

All requests go directly from your browser to your Bluesky PDS (Personal Data Server), exactly the same as the app itself does.

---

## Prerequisites

- A [Bluesky](https://bsky.app) account.
- A modern browser with DevTools (Chrome, Firefox, Edge, Safari).
- You must be **logged into [bsky.app](https://bsky.app)** in that same browser tab before running any script.

---

## Scripts

### 1. Delete all posts

**File:** [`delete-posts.js`](./delete-posts.js)

Removes every post from your account, including replies you authored. It does **not** touch your likes, reposts, follows, or profile.

```js
(async () => {
  // ================================================================
  //  🦋  BLUESKY — DELETE ALL MY POSTS
  //  Paste into DevTools console while logged in at https://bsky.app
  // ================================================================

  // ⚙️  CONFIG — flip to false when you're ready to actually delete
  const DRY_RUN = true;

  // Delay between each delete call (ms). Raise if you hit rate-limit errors.
  const DELAY_MS = 80;

  // ----------------------------------------------------------------
  //  1. Pull the auth session straight from bsky.app's localStorage
  // ----------------------------------------------------------------
  let did, accessJwt, handle, pdsUrl;

  function findSession(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;
    if (obj.accessJwt && obj.did) return obj;
    for (const val of Object.values(obj)) {
      const hit = findSession(val, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  for (const key of Object.keys(localStorage)) {
    try {
      const session = findSession(JSON.parse(localStorage.getItem(key)));
      if (session) {
        ({ did, accessJwt, handle } = session);
        pdsUrl = (session.pdsUrl || "https://bsky.social").replace(/\/$/, "");
        break;
      }
    } catch (_) {}
  }

  if (!did || !accessJwt) {
    console.error(
      "❌ No session found.\n" +
      "   Make sure you are logged in at https://bsky.app, then try again.\n" +
      "   If the token expired, refresh the page first."
    );
    return;
  }

  console.log("🦋 Bluesky Post Deleter");
  console.log(`👤 Account : ${handle ?? did}`);
  console.log(`🌐 PDS     : ${pdsUrl}`);
  if (DRY_RUN)
    console.warn("⚠️  DRY RUN is ON — nothing will actually be deleted.\n" +
                 "   Set DRY_RUN = false at the top of the script to delete for real.");

  // ----------------------------------------------------------------
  //  2. Collect every post URI (paginated)
  // ----------------------------------------------------------------
  console.log("\n📋 Fetching your posts…");
  const uris = [];
  let cursor;

  do {
    const qs = new URLSearchParams({
      repo: did,
      collection: "app.bsky.feed.post",
      limit: "100",
    });
    if (cursor) qs.set("cursor", cursor);

    const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.listRecords?${qs}`, {
      headers: { Authorization: `Bearer ${accessJwt}` },
    });
    const data = await res.json();

    if (data.error) {
      console.error(`❌ API error: ${data.error} — ${data.message}`);
      if (data.error === "ExpiredToken")
        console.info("💡 Refresh the bsky.app tab and run the script again.");
      return;
    }

    for (const r of data.records ?? []) uris.push(r.uri);
    cursor = data.cursor;
    console.log(`   …${uris.length} posts fetched so far`);
  } while (cursor);

  if (uris.length === 0) {
    console.log("✅ No posts found — nothing to delete!");
    return;
  }

  console.log(`\n📊 Total posts found: ${uris.length}`);

  // ----------------------------------------------------------------
  //  3. Confirm before nuking everything
  // ----------------------------------------------------------------
  if (!DRY_RUN) {
    const ok = confirm(
      `⚠️  You are about to PERMANENTLY delete all ${uris.length} posts` +
      ` from @${handle ?? did}.\n\nThis cannot be undone!\n\nClick OK to proceed.`
    );
    if (!ok) {
      console.log("🚫 Cancelled. No posts were deleted.");
      return;
    }
  }

  // ----------------------------------------------------------------
  //  4. Delete posts one by one
  // ----------------------------------------------------------------
  console.log(`\n🗑️  ${DRY_RUN ? "[DRY RUN] Simulating deletion of" : "Deleting"} ${uris.length} posts…`);

  let deleted = 0;
  let failed  = 0;

  for (const uri of uris) {
    const rkey = uri.split("/").pop();

    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would delete → ${uri}`);
      deleted++;
    } else {
      try {
        const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.deleteRecord`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessJwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repo: did,
            collection: "app.bsky.feed.post",
            rkey,
          }),
        });

        if (res.ok) {
          deleted++;
          if (deleted % 25 === 0)
            console.log(`   ✅ ${deleted} / ${uris.length} deleted…`);
        } else {
          failed++;
          const err = await res.json().catch(() => ({}));
          console.warn(`   ⚠️  Failed (${rkey}): ${err.message ?? res.status}`);
        }
      } catch (e) {
        failed++;
        console.warn(`   ⚠️  Error (${rkey}): ${e.message}`);
      }
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  // ----------------------------------------------------------------
  //  5. Summary
  // ----------------------------------------------------------------
  console.log("\n✨ Done!");
  console.log(`   ✅ ${DRY_RUN ? "Would delete" : "Deleted"}: ${deleted} posts`);
  if (failed > 0)
    console.warn(`   ❌ Failed: ${failed} posts (check warnings above)`);
  if (DRY_RUN)
    console.warn('\n👆 Set DRY_RUN = false at the top and re-run to delete for real.');
})();
```

---

### 2. Remove all likes and reposts

**File:** [`delete-likes-reposts.js`](./delete-likes-reposts.js)

Removes your likes and/or reposts. Posts themselves are left untouched. You can disable either action via the config flags at the top.

```js
(async () => {
  // ================================================================
  //  🦋  BLUESKY — REMOVE ALL MY LIKES & REPOSTS
  //  Paste into DevTools console while logged in at https://bsky.app
  // ================================================================

  // ⚙️  CONFIG — flip to false when you're ready to actually delete
  const DRY_RUN = true;

  // Toggle which actions to clean up
  const REMOVE_LIKES   = true;
  const REMOVE_REPOSTS = true;

  // Delay between each delete call (ms). Raise if you hit rate-limit errors.
  const DELAY_MS = 80;

  // ----------------------------------------------------------------
  //  1. Pull the auth session from bsky.app's localStorage
  // ----------------------------------------------------------------
  let did, accessJwt, handle, pdsUrl;

  function findSession(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;
    if (obj.accessJwt && obj.did) return obj;
    for (const val of Object.values(obj)) {
      const hit = findSession(val, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  for (const key of Object.keys(localStorage)) {
    try {
      const session = findSession(JSON.parse(localStorage.getItem(key)));
      if (session) {
        ({ did, accessJwt, handle } = session);
        pdsUrl = (session.pdsUrl || "https://bsky.social").replace(/\/$/, "");
        break;
      }
    } catch (_) {}
  }

  if (!did || !accessJwt) {
    console.error(
      "❌ No session found.\n" +
      "   Make sure you are logged in at https://bsky.app, then try again.\n" +
      "   If the token expired, refresh the page first."
    );
    return;
  }

  console.log("🦋 Bluesky Likes & Reposts Remover");
  console.log(`👤 Account : ${handle ?? did}`);
  console.log(`🌐 PDS     : ${pdsUrl}`);
  console.log(`❤️  Likes   : ${REMOVE_LIKES   ? "YES" : "skip"}`);
  console.log(`🔁 Reposts : ${REMOVE_REPOSTS ? "YES" : "skip"}`);
  if (DRY_RUN)
    console.warn(
      "\n⚠️  DRY RUN is ON — nothing will actually be removed.\n" +
      "   Set DRY_RUN = false at the top of the script to remove for real."
    );

  // ----------------------------------------------------------------
  //  2. Helper — fetch ALL record URIs for a given collection
  // ----------------------------------------------------------------
  async function fetchAllUris(collection) {
    const uris = [];
    let cursor;
    do {
      const qs = new URLSearchParams({ repo: did, collection, limit: "100" });
      if (cursor) qs.set("cursor", cursor);

      const res = await fetch(
        `${pdsUrl}/xrpc/com.atproto.repo.listRecords?${qs}`,
        { headers: { Authorization: `Bearer ${accessJwt}` } }
      );
      const data = await res.json();

      if (data.error) {
        console.error(`❌ API error fetching ${collection}: ${data.error} — ${data.message}`);
        if (data.error === "ExpiredToken")
          console.info("💡 Refresh the bsky.app tab and run the script again.");
        return null;
      }

      for (const r of data.records ?? []) uris.push(r.uri);
      cursor = data.cursor;
      if (uris.length > 0) console.log(`   …${uris.length} ${collection.split(".").pop()}s fetched so far`);
    } while (cursor);

    return uris;
  }

  // ----------------------------------------------------------------
  //  3. Helper — delete a list of URIs from a given collection
  // ----------------------------------------------------------------
  async function deleteAll(uris, collection, label) {
    if (uris.length === 0) {
      console.log(`   Nothing to remove in ${label}.`);
      return { deleted: 0, failed: 0 };
    }

    console.log(
      `\n🗑️  ${DRY_RUN ? "[DRY RUN] Simulating removal of" : "Removing"} ` +
      `${uris.length} ${label}…`
    );

    let deleted = 0, failed = 0;

    for (const uri of uris) {
      const rkey = uri.split("/").pop();

      if (DRY_RUN) {
        console.log(`   [DRY RUN] Would remove → ${uri}`);
        deleted++;
      } else {
        try {
          const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.deleteRecord`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessJwt}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ repo: did, collection, rkey }),
          });

          if (res.ok) {
            deleted++;
            if (deleted % 25 === 0)
              console.log(`   ✅ ${deleted} / ${uris.length} ${label} removed…`);
          } else {
            failed++;
            const err = await res.json().catch(() => ({}));
            console.warn(`   ⚠️  Failed (${rkey}): ${err.message ?? res.status}`);
          }
        } catch (e) {
          failed++;
          console.warn(`   ⚠️  Error (${rkey}): ${e.message}`);
        }
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    return { deleted, failed };
  }

  // ----------------------------------------------------------------
  //  4. Fetch counts for both collections before confirming
  // ----------------------------------------------------------------
  const collections = [];
  if (REMOVE_LIKES)   collections.push({ key: "app.bsky.feed.like",   label: "likes" });
  if (REMOVE_REPOSTS) collections.push({ key: "app.bsky.feed.repost", label: "reposts" });

  if (collections.length === 0) {
    console.warn("⚠️  Both REMOVE_LIKES and REMOVE_REPOSTS are false. Nothing to do.");
    return;
  }

  const batches = [];
  for (const { key, label } of collections) {
    console.log(`\n📋 Fetching your ${label}…`);
    const uris = await fetchAllUris(key);
    if (uris === null) return;
    console.log(`   Total ${label} found: ${uris.length}`);
    batches.push({ key, label, uris });
  }

  const totalRecords = batches.reduce((n, b) => n + b.uris.length, 0);

  if (totalRecords === 0) {
    console.log("\n✅ Nothing to remove — you have no likes or reposts!");
    return;
  }

  // ----------------------------------------------------------------
  //  5. Confirm before removing everything
  // ----------------------------------------------------------------
  if (!DRY_RUN) {
    const summary = batches
      .filter(b => b.uris.length > 0)
      .map(b => `${b.uris.length} ${b.label}`)
      .join(" and ");

    const ok = confirm(
      `⚠️  You are about to PERMANENTLY remove ${summary} from @${handle ?? did}.\n\n` +
      `This cannot be undone!\n\nClick OK to proceed.`
    );
    if (!ok) {
      console.log("🚫 Cancelled. Nothing was removed.");
      return;
    }
  }

  // ----------------------------------------------------------------
  //  6. Delete all collected records
  // ----------------------------------------------------------------
  let totalDeleted = 0, totalFailed = 0;

  for (const { key, label, uris } of batches) {
    const { deleted, failed } = await deleteAll(uris, key, label);
    totalDeleted += deleted;
    totalFailed  += failed;
  }

  // ----------------------------------------------------------------
  //  7. Summary
  // ----------------------------------------------------------------
  console.log("\n✨ Done!");
  console.log(`   ✅ ${DRY_RUN ? "Would remove" : "Removed"}: ${totalDeleted} records`);
  if (totalFailed > 0)
    console.warn(`   ❌ Failed: ${totalFailed} records (check warnings above)`);
  if (DRY_RUN)
    console.warn("\n👆 Set DRY_RUN = false at the top and re-run to remove for real.");
})();
```

---

## Usage

The flow is the same for both scripts:

**Step 1 — Open bsky.app and log in**

Go to [https://bsky.app](https://bsky.app) and make sure you are signed in to the account you want to clean up.

**Step 2 — Open the browser DevTools console**

| Browser | Shortcut |
|---|---|
| Chrome / Edge | `F12` then click **Console**, or `Ctrl + Shift + J` |
| Firefox | `F12` then click **Console**, or `Ctrl + Shift + K` |
| Safari | Enable DevTools in Settings → Advanced, then `⌘ + Option + C` |
| Any (Mac) | `⌘ + Option + J` |

**Step 3 — Paste and run (dry run first)**

Copy the script you want, paste it into the console, and press **Enter**. With `DRY_RUN = true` (the default), the script will only simulate — it logs what it *would* delete without touching anything.

**Step 4 — Review the output**

Check the console output to confirm the count looks right and no errors appeared.

**Step 5 — Run for real**

Set `DRY_RUN = false` at the top of the script, paste it again, and confirm the browser popup to proceed with actual deletion.

---

## Configuration options

### Delete posts

| Option | Type | Default | Description |
|---|---|---|---|
| `DRY_RUN` | `boolean` | `true` | Simulate without deleting anything |
| `DELAY_MS` | `number` | `80` | Milliseconds between API calls |

### Remove likes & reposts

| Option | Type | Default | Description |
|---|---|---|---|
| `DRY_RUN` | `boolean` | `true` | Simulate without removing anything |
| `REMOVE_LIKES` | `boolean` | `true` | Remove all your ❤️ likes |
| `REMOVE_REPOSTS` | `boolean` | `true` | Remove all your 🔁 reposts |
| `DELAY_MS` | `number` | `80` | Milliseconds between API calls |

---

## Troubleshooting

**`❌ No session found`**
Make sure you are logged in at [bsky.app](https://bsky.app) in the same tab where you are running the script, and that you are on the `bsky.app` domain (not a third-party client).

**`❌ API error: ExpiredToken`**
Your login session has timed out. Refresh the bsky.app page — this renews the token — then paste the script again.

**Many `⚠️ Failed` warnings**
You may be hitting the API rate limit. Increase `DELAY_MS` to `200` or higher and re-run.

**The script stops partway through**
If the browser tab is closed or the session expires mid-run, simply re-run the script. Already-deleted records will be gone; the script will pick up the remaining ones on the next run since they are fetched fresh each time.

---

## Limitations

- These scripts only remove content you own. They cannot remove replies or quotes made by other users.
- The **delete posts** script removes all posts including your own replies in threads.
- The **delete likes & reposts** script does not affect posts themselves.
- Follows, blocks, mutes, lists, and profile data are not touched by either script.
- If you self-host on a custom PDS, the scripts should still work as long as your session's `pdsUrl` is correctly stored by the bsky.app client.

---

## Disclaimer

These scripts interact with the official AT Protocol API on your behalf, using your own credentials stored in your own browser. Use them at your own risk. The author is not responsible for any unintended data loss. **Always run in `DRY_RUN` mode first.**
