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
