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
    console.warn(
      "⚠️  DRY RUN is ON — nothing will actually be deleted.\n" +
      "   Set DRY_RUN = false at the top of the script to delete for real."
    );

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
    console.warn("\n👆 Set DRY_RUN = false at the top and re-run to delete for real.");
})();
