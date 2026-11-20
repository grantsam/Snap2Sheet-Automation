// Browser-side media decryption script for WhatsApp Web / Puppeteer
// This file is intentionally plain JS (not TS) so tsx/esbuild does NOT transform it.
// It is loaded via fs.readFileSync and passed as a string to page.evaluate().
//
// Called as: page.evaluate(SCRIPT_STRING, messageId, mediaParams)
// Returns: { data, mimetype, filename, filesize } | { error: string } | null

(async function (msgId, params) {
  try {
    // ── Step 1: Try to locate the message in WhatsApp's in-memory store ──
    var msg = null;
    if (msgId) {
      try {
        var MsgCollection = window.require("WAWebCollections").Msg;
        var MsgKey = window.require("WAWebMsgKey");
        if (MsgKey && typeof MsgKey.fromString === "function") {
          try { msg = MsgCollection.get(MsgKey.fromString(msgId)); } catch (_) {}
        }
        if (!msg) {
          try { msg = MsgCollection.get(msgId); } catch (_) {}
        }
        if (!msg && MsgCollection.models) {
          msg = MsgCollection.models.find(function (m) {
            return m.id && (
              m.id._serialized === msgId ||
              m.id.id === msgId ||
              String(m.id) === msgId
            );
          });
        }
      } catch (_) {}
    }

    // ── Step 2: Blob URL path (fastest — already decrypted in browser) ──
    if (msg && msg.mediaData && msg.mediaData.renderableUrl) {
      try {
        var blobResp = await fetch(msg.mediaData.renderableUrl);
        var arrayBuf = await blobResp.arrayBuffer();
        var bytes = new Uint8Array(arrayBuf);
        var binary = "";
        for (var i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        return {
          data: window.btoa(binary),
          mimetype: (msg.mimetype) || (params.mimetype) || "image/jpeg",
          filename: (msg.filename) || (params.filename) || null,
          filesize: bytes.length,
        };
      } catch (_) {}
    }

    // ── Step 3: CDN decrypt via WAWebDownloadManager ──
    var directPath = params.directPath || (msg && (msg.directPath || (msg.mediaData && msg.mediaData.directPath)));
    var encFilehash = params.encFilehash || (msg && (msg.encFilehash || (msg.mediaData && msg.mediaData.encFilehash)));
    var filehash = params.filehash || (msg && (msg.filehash || (msg.mediaData && msg.mediaData.filehash)));
    var mediaKey = params.mediaKey || (msg && (msg.mediaKey || (msg.mediaData && msg.mediaData.mediaKey)));
    var mediaKeyTimestamp = params.mediaKeyTimestamp || (msg && (msg.mediaKeyTimestamp || (msg.mediaData && msg.mediaData.mediaKeyTimestamp)));
    var type = params.type || (msg && (msg.type || (msg.mediaData && msg.mediaData.type))) || "image";
    var mimetype = params.mimetype || (msg && msg.mimetype) || (type === "image" ? "image/jpeg" : "application/octet-stream");

    if (!directPath || !mediaKey) {
      return { error: "Missing directPath or mediaKey" };
    }

    var dmModule = window.require("WAWebDownloadManager");
    var dm = (dmModule && dmModule.downloadManager) ? dmModule.downloadManager : dmModule;

    var decryptedMedia = await dm.downloadAndMaybeDecrypt({
      directPath: directPath,
      encFilehash: encFilehash,
      filehash: filehash,
      mediaKey: mediaKey,
      mediaKeyTimestamp: mediaKeyTimestamp,
      type: type,
      mimetype: mimetype,
      signal: new AbortController().signal,
      downloadQpl: { addAnnotations: function () {}, addPoint: function () {} },
    });

    var arrayBuffer = decryptedMedia;
    if (decryptedMedia && typeof decryptedMedia.arrayBuffer === "function") {
      arrayBuffer = await decryptedMedia.arrayBuffer();
    } else if (decryptedMedia instanceof Uint8Array) {
      arrayBuffer = decryptedMedia.buffer;
    } else if (decryptedMedia && decryptedMedia.data) {
      arrayBuffer = typeof decryptedMedia.data.arrayBuffer === "function"
        ? await decryptedMedia.data.arrayBuffer()
        : decryptedMedia.data;
    }

    if (!arrayBuffer) return { error: "decryptedMedia buffer empty" };

    var bytes2 = new Uint8Array(arrayBuffer);
    var binary2 = "";
    for (var j = 0; j < bytes2.length; j += 8192) {
      binary2 += String.fromCharCode.apply(null, bytes2.subarray(j, j + 8192));
    }

    return {
      data: window.btoa(binary2),
      mimetype: params.mimetype || (msg && msg.mimetype) || "image/jpeg",
      filename: params.filename || (msg && msg.filename) || null,
      filesize: bytes2.length,
    };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
})
