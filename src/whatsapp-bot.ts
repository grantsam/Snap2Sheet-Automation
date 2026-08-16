import { Client, LocalAuth, type Message, type MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import type { AppConfig } from "./config";
import { isSenderAllowed } from "./config";
import { KeyedQueue } from "./keyed-queue";
import { Logger } from "./logger";
import {
  extractSentenceReport,
  InputError,
  parseAttachmentSlot,
  parseStartCommand,
} from "./parser";
import { JsonStateStore } from "./state-store";
import { SubmissionService } from "./submission-service";

export interface BotStatus {
  whatsapp: "starting" | "qr_required" | "ready" | "disconnected" | "auth_failure";
  lastEventAt: string;
}

function help(prefix: string): string {
  return [
    "*Snap2Sheet — format laporan*",
    "",
    "Kirim 6 foto sekaligus dengan caption:",
    "0000 minz ( <nomor registrasi> <nama pelanggan> )",
    "",
    "Contoh:",
    "0000 minz ( 12345 Budi Santoso )",
    "",
    `Perintah opsional: ${prefix}status, ${prefix}batal konfirmasi, ${prefix}idgrup`,
  ].join("\n");
}

function resolveMessageId(message: Message): string {
  const msgObj = message as unknown as {
    id?: { _serialized?: string; id?: string; remote?: string; fromMe?: boolean };
    _data?: { id?: { _serialized?: string; id?: string; remote?: string; fromMe?: boolean } | string };
  };
  return (
    (typeof msgObj.id === "object" && msgObj.id?._serialized) ||
    (typeof msgObj.id === "object" &&
      msgObj.id?.id &&
      `${msgObj.id.fromMe ? "true" : "false"}_${msgObj.id.remote}_${msgObj.id.id}`) ||
    (typeof msgObj._data?.id === "object" && msgObj._data.id?._serialized) ||
    (typeof msgObj._data?.id === "object" &&
      msgObj._data.id?.id &&
      `${msgObj._data.id.fromMe ? "true" : "false"}_${msgObj._data.id.remote}_${msgObj._data.id.id}`) ||
    (typeof msgObj.id === "string" ? msgObj.id : "") ||
    (typeof msgObj._data?.id === "string" ? msgObj._data.id : "") ||
    `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
}

export class WhatsAppBot {
  readonly status: BotStatus = { whatsapp: "starting", lastEventAt: new Date().toISOString() };
  private readonly client: Client;
  private readonly queue = new KeyedQueue();
  private readonly mediaBuffer = new Map<
    string,
    {
      buffer: Buffer;
      mimeType: string;
      originalName?: string;
      sourceMessageId: string;
      timestamp: number;
    }[]
  >();

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStateStore,
    private readonly submissions: SubmissionService,
    private readonly logger: Logger,
  ) {
    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.waAuthPath, clientId: "snap2sheet" }),
      puppeteer: {
        headless: true,
        ...(config.puppeteerExecutablePath
          ? { executablePath: config.puppeteerExecutablePath }
          : {}),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      },
    });
    this.registerEvents();
  }

  async start(): Promise<void> {
    this.logger.info("Memulai WhatsApp Web client.");
    try {
      await this.client.initialize();
    } catch (error) {
      await this.client.destroy().catch(() => {});
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.client.destroy().catch(() => {});
  }

  public async syncBackwards(limit = 500): Promise<{ scanned: number; processed: number }> {
    const targetId = this.config.targetGroupId?.trim();
    if (!targetId) {
      this.logger.warn("TARGET_GROUP_ID belum diisi di .env.");
      return { scanned: 0, processed: 0 };
    }

    this.logger.info(`🔍 Memindai riwayat pesan grup [ ${targetId} ]...`);

    let allMessages: Message[] = [];
    if ((this.client as any).pupPage) {
      const evaluateScript = `
        async (cid, limit) => {
          try {
            const chat = await window.WWebJS.getChat(cid, { getAsModel: false });
            if (!chat) return [];

            var msgFilter = function(m) {
              return m && !m.isNotification;
            };

            var msgs = chat.msgs && chat.msgs.getModelsArray ? chat.msgs.getModelsArray().filter(msgFilter) : [];
            var loader = window.require ? window.require('WAWebChatLoadMessages') : (window.Store && window.Store.LoadEarlierMsgs);

            var retries = 0;
            while (msgs.length < limit && retries < 20 && loader && loader.loadEarlierMsgs) {
              var loaded = await loader.loadEarlierMsgs({ chat: chat });
              if (!loaded || !loaded.length) {
                retries++;
                await new Promise(function(r) { setTimeout(r, 200); });
                continue;
              }
              msgs = loaded.filter(msgFilter).concat(msgs);
              retries = 0;
            }

            return msgs.map(function(m) { return window.WWebJS.getMessageModel(m); });
          } catch (err) {
            return { error: String((err && err.message) || err) };
          }
        }
      `;

      const rawMsgs = await (this.client as any).pupPage
        .evaluate(new Function(`return (${evaluateScript})`)(), targetId, limit)
        .catch((err: any) => ({ error: String(err) }));

      if (Array.isArray(rawMsgs)) {
        // @ts-ignore
        const MessageClass = require("whatsapp-web.js/src/structures/Message");
        allMessages = rawMsgs.map((m: any) => new MessageClass(this.client, m));
      } else if (rawMsgs && typeof rawMsgs === "object" && "error" in rawMsgs) {
        this.logger.warn("Gagal memuat riwayat chat:", { error: (rawMsgs as any).error });
      }
    }

    this.logger.info(`📥 Berhasil memuat ${allMessages.length} pesan riwayat grup.`);
    allMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const sheetInfo = await this.submissions
      .getExistingSheetInfo()
      .catch(() => ({ existingNoregs: new Set<string>() }));

    let processed = 0;
    for (const msg of allMessages) {
      if (
        msg.fromMe &&
        (msg.body.startsWith("📌") ||
          msg.body.startsWith("✅") ||
          msg.body.startsWith("⚠️") ||
          msg.body.startsWith("📝") ||
          msg.body.startsWith("❌") ||
          msg.body.startsWith("🗑️") ||
          msg.body.startsWith("🔄") ||
          msg.body.startsWith("*Snap2Sheet"))
      ) {
        continue;
      }
      if ((msg as any).isNotification) continue;

      const body = (msg.body || "").trim();
      const sentencePayload = extractSentenceReport(body);

      if (
        sentencePayload &&
        sheetInfo.existingNoregs.has(sentencePayload.registrationNumber.toLowerCase())
      ) {
        const senderId = msg.author || msg.from;
        const key = SubmissionService.draftKey(targetId, senderId);
        this.mediaBuffer.delete(key);
        this.logger.debug(
          `⏩ Laporan ${sentencePayload.registrationNumber} (${sentencePayload.customerName}) sudah ada di Google Sheets, dilewati.`,
        );
        continue;
      }

      this.logger.info(
        `🔎 Menganalisis: "${body?.slice(0, 40) || "[Foto / Media]"}" (media: ${msg.hasMedia})`,
      );
      await this.routeMessage(msg);
      processed++;
    }

    this.logger.info(`✅ Sinkronisasi riwayat selesai. ${processed} pesan baru diproses.`);
    return { scanned: allMessages.length, processed };
  }

  private updateStatus(status: BotStatus["whatsapp"]): void {
    this.status.whatsapp = status;
    this.status.lastEventAt = new Date().toISOString();
  }

  private isTargetGroup(chatId: string, groupName: string): boolean {
    if (this.config.targetGroupId) {
      const cleanTargetId = this.config.targetGroupId.replace(/@.*$/, "");
      const cleanChatId = chatId.replace(/@.*$/, "");
      if (chatId === this.config.targetGroupId || cleanChatId === cleanTargetId) return true;
    }
    if (this.config.targetGroupName && groupName) {
      return groupName.toLowerCase().includes(this.config.targetGroupName.toLowerCase());
    }
    return false;
  }

  private registerEvents(): void {
    this.client.on("qr", (qr) => {
      this.updateStatus("qr_required");
      this.logger.warn("QR WhatsApp perlu dipindai. Buka Perangkat tertaut pada ponsel.", { qr });
      qrcode.generate(qr, { small: true });
    });
    this.client.on("ready", () => {
      this.updateStatus("ready");
      this.logger.info("WhatsApp client siap menerima pesan.");
    });
    this.client.on("authenticated", () => {
      this.logger.info("Sesi WhatsApp berhasil diautentikasi.");
    });
    this.client.on("auth_failure", (message) => {
      this.updateStatus("auth_failure");
      this.logger.error("Autentikasi WhatsApp gagal.", message);
    });
    this.client.on("disconnected", (reason) => {
      this.updateStatus("disconnected");
      this.logger.warn("WhatsApp terputus.", { reason: String(reason) });
    });
    this.client.on("message_create", (message) => {
      void this.routeMessage(message);
    });
  }

  private async routeMessage(message: Message): Promise<void> {
    try {
      if (message.from === "status@broadcast") return;
      // Prevent infinite loop if the message was sent by the bot's own automated response
      if (
        message.fromMe &&
        (message.body.startsWith("📌") ||
          message.body.startsWith("✅") ||
          message.body.startsWith("⚠️") ||
          message.body.startsWith("📝") ||
          message.body.startsWith("❌") ||
          message.body.startsWith("*Snap2Sheet"))
      ) {
        return;
      }

      // Resolve true chat destination (for self-sent group messages, message.from is user LID while message.id.remote is the group JID)
      const chatId =
        message.id?.remote ||
        (message.fromMe && message.to?.endsWith("@g.us") ? message.to : message.from);
      const isGroup = chatId.endsWith("@g.us");
      const senderId = message.author || message.from;

      let groupName = "";
      if (isGroup) {
        try {
          const chat = await message.getChat();
          groupName = chat?.name || "";
        } catch {
          groupName =
            (message as unknown as { _data?: { chat?: { name?: string } } })._data?.chat
              ?.name || "";
        }
      }

      const bodyLower = message.body.trim().toLowerCase();
      const prefix = this.config.commandPrefix.toLowerCase();
      const isIdCommand = [
        `${prefix}idgrup`,
        `${prefix}idgroup`,
        `${prefix}id`,
        "!idgrup",
        "!idgroup",
        "!id",
        "idgrup",
        "idgroup",
        "/idgrup",
        "/idgroup",
        "!id grup",
        "!id group",
      ].includes(bodyLower);

      // Strict filter: Ignore other unrelated groups immediately
      if (isGroup) {
        if (!this.isTargetGroup(chatId, groupName) && !isIdCommand) {
          return;
        }
      } else {
        // In private chat: only accept allowed senders, notify target, or id command
        const isFromAllowed = isSenderAllowed(this.config, senderId);
        const isNotifyTarget =
          Boolean(this.config.notifyTargetId) &&
          (senderId === this.config.notifyTargetId || chatId === this.config.notifyTargetId);
        if (!isFromAllowed && !isNotifyTarget && !isIdCommand && !message.fromMe) {
          return;
        }
      }

      // If sender is not allowed
      if (!isSenderAllowed(this.config, senderId) && !isIdCommand && !message.fromMe) return;

      // Debug only: Do not pollute console with regular group chatter
      this.logger.debug("Pesan masuk:", {
        chatId,
        from: senderId,
        body: message.body?.slice(0, 40),
        isGroup,
        fromMe: message.fromMe,
      });

      // If user is asking for the group ID
      if (isIdCommand) {
        this.logger.info("⚙️ Perintah !idgrup diminta oleh:", { senderId });
        if (!isGroup) {
          await this.client.sendMessage(
            chatId,
            `📌 *Snap2Sheet — Chat Langsung*\nIni adalah chat pribadi dengan bot.\n\n💡 *Untuk mendapatkan ID grup:*\nBuka *Grup WhatsApp* tempat bot ini menjadi anggota, lalu ketik \`!idgroup\` di dalam grup tersebut.`,
          );
          return;
        }
        await this.client.sendMessage(
          chatId,
          `📌 *Snap2Sheet — Info Grup*\nNama grup: *${groupName || "(tidak terbaca)"}*\n\nSalin nilai berikut ke .env:\n\`TARGET_GROUP_ID=${chatId}\``,
        );
        return;
      }

      if (bodyLower === "!sinkron" || bodyLower === `${prefix}sinkron` || bodyLower === "!sync") {
        try {
          const targetId = this.config.targetGroupId || chatId;
          const targetChat = await this.client.getChatById(targetId);
          if (targetChat) {
            const recent = await targetChat.fetchMessages({ limit: 50 });
            recent.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            let processedCount = 0;
            for (const msg of recent) {
              const msgId = resolveMessageId(msg);
              if (!(await this.store.hasProcessedMessage(msgId))) {
                await this.routeMessage(msg);
                processedCount++;
              }
            }
            this.logger.info(
              `🔄 Sinkronisasi manual selesai. 50 pesan diperiksa, ${processedCount} pesan baru diproses.`,
            );
            if (this.config.notifyTargetId) {
              await this.client.sendMessage(
                this.config.notifyTargetId,
                `🔄 *Sinkronisasi Selesai*\nMemeriksa 50 pesan terakhir. Pesan baru diproses: ${processedCount}.`,
              ).catch(() => {});
            }
          }
        } catch (syncErr) {
          this.logger.error(`⚠️ Gagal sinkronisasi: ${String(syncErr)}`);
          if (this.config.notifyTargetId) {
            await this.client.sendMessage(
              this.config.notifyTargetId,
              `⚠️ Gagal sinkronisasi: ${String(syncErr)}`,
            ).catch(() => {});
          }
        }
        return;
      }

      const key = SubmissionService.draftKey(chatId, senderId);
      await this.queue.run(key, async () => {
        const messageId = resolveMessageId(message);
        if (await this.store.hasProcessedMessage(messageId)) return;
        await this.store.markMessageProcessed(messageId);
        const response = await this.handleMessage(message, key, senderId, groupName, chatId, messageId);
        if (!response) return;

        // Route notification to UI Console Logger (Passive Mode - Do NOT DM client)
        this.logger.info(response);

        // Only send WA notification if explicit admin notifyTargetId is configured
        if (this.config.notifyTargetId) {
          try {
            await this.client.sendMessage(this.config.notifyTargetId, response);
          } catch (err) {
            this.logger.debug("Gagal mengirim notif ke admin notifyTargetId:", { error: String(err) });
          }
        }
      });
    } catch (error) {
      const errText = error instanceof InputError ? error.message : "Terjadi kesalahan internal saat memproses pesan.";
      this.logger.error(`❌ ${errText}`, { error: String(error) });
    }
  }

  private async handleMessage(
    message: Message,
    key: string,
    senderId: string,
    groupName: string,
    chatId: string,
    messageId: string,
  ): Promise<string | undefined> {
    const body = message.body.trim();
    const lower = body.toLowerCase();
    const prefix = this.config.commandPrefix.toLowerCase();
    const sentencePayload = extractSentenceReport(body);

    if (sentencePayload) {
      const sheetInfo = await this.submissions.getExistingSheetInfo().catch(() => ({ existingNoregs: new Set<string>() }));
      if (sheetInfo.existingNoregs.has(sentencePayload.registrationNumber.toLowerCase())) {
        this.mediaBuffer.delete(key);
        this.logger.debug(
          `⏩ Laporan ${sentencePayload.registrationNumber} (${sentencePayload.customerName}) sudah ada di Google Sheets, dilewati.`,
        );
        return undefined;
      }
    }

    let senderName = senderId;
    try {
      const contact = await message.getContact();
      senderName = contact?.pushname || contact?.name || senderId;
    } catch {
      senderName =
        (message as unknown as { _data?: { notifyName?: string } })._data?.notifyName ||
        senderId;
    }

    const hasMedia = Boolean(message.hasMedia || message.type === "image" || message.type === "document");
    if (hasMedia) {
      let media: MessageMedia | undefined;
      for (let i = 0; i < 6 && !media; i++) {
        try {
          media = await message.downloadMedia();
          if (media && media.data) break;
        } catch {}
        if (i < 5) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }

      if (!media?.data) {
        this.logger.warn("Media WhatsApp gagal diunduh atau belum selesai ditransfer.", {
          messageId,
        });
        return undefined;
      }

      const msgTimestamp = message.timestamp ? message.timestamp * 1000 : Date.now();
      const mediaItem = {
        buffer: Buffer.from(media.data, "base64"),
        mimeType: media.mimetype,
        ...(media.filename ? { originalName: media.filename } : {}),
        sourceMessageId: messageId,
        timestamp: msgTimestamp,
      };

      let draft = await this.submissions.getDraft(key);

      // Case 1: Caption is on this image (e.g. 4894 robiah)
      if (sentencePayload) {
        this.logger.info("📝 Mulai draft laporan baru:", {
          noreg: sentencePayload.registrationNumber,
          nama: sentencePayload.customerName,
          pengirim: senderName,
        });
        draft = await this.submissions.startOrReset(
          chatId,
          senderId,
          senderName,
          sentencePayload,
        );

        // Attach any pending buffered photos that arrived just before the captioned photo
        const buffered = (this.mediaBuffer.get(key) || []).filter(
          (b) => Math.abs(msgTimestamp - b.timestamp) < 300_000,
        );
        this.mediaBuffer.delete(key);

        for (const item of buffered) {
          const nextSlot = SubmissionService.getNextSlot(draft);
          if (!nextSlot) break;
          const attachRes = await this.submissions.attach(key, nextSlot, item);
          draft = attachRes.draft;
          this.logger.info("📸 Foto terlampir dari buffer:", {
            slot: nextSlot,
            total: attachRes.count,
            noreg: draft.registrationNumber,
          });
        }

        // Attach this captioned photo
        const slot = parseAttachmentSlot(body) ?? SubmissionService.getNextSlot(draft);
        if (slot) {
          const attachRes = await this.submissions.attach(key, slot, mediaItem);
          draft = attachRes.draft;
          this.logger.info("📸 Foto utama terlampir:", {
            slot,
            total: attachRes.count,
            noreg: draft.registrationNumber,
          });
          if (attachRes.isComplete) {
            this.logger.info("✅ Laporan 6 foto lengkap! Menyimpan ke Google Drive & Sheets...", {
              noreg: draft.registrationNumber,
            });
            return this.submissions.complete(key);
          }
        }
        return undefined;
      }

      // Case 2: Draft already exists from a prior captioned photo or text
      if (draft) {
        const slot = parseAttachmentSlot(body) ?? SubmissionService.getNextSlot(draft);
        if (slot) {
          const result = await this.submissions.attach(key, slot, mediaItem);
          this.logger.info("📸 Foto terlampir:", {
            slot,
            total: result.count,
            noreg: draft.registrationNumber,
          });
          if (result.isComplete) {
            this.logger.info("✅ Laporan 6 foto lengkap! Menyimpan ke Google Drive & Sheets...", {
              noreg: draft.registrationNumber,
            });
            return this.submissions.complete(key);
          }
        }
        return undefined;
      }

      // Case 3: No draft yet (photos 1-5 arrived before the captioned photo)
      const currentList = (this.mediaBuffer.get(key) || []).filter(
        (b) => Math.abs(msgTimestamp - b.timestamp) < 300_000 && b.sourceMessageId !== messageId,
      );
      currentList.push(mediaItem);
      this.mediaBuffer.set(key, currentList);
      this.logger.info(`📥 Menampung foto awal (${currentList.length}) menunggu nomor registrasi...`);
      return undefined;
    }

    // Pure text message with sentence report format: 0000 minz ( <noreg> <nama> ) or 4894 robiah
    if (sentencePayload) {
      const msgTimestamp = message.timestamp ? message.timestamp * 1000 : Date.now();
      const contact = await message.getContact();
      const senderName = contact.pushname || contact.name || senderId;
      let draft = await this.submissions.startOrReset(
        chatId,
        senderId,
        senderName,
        sentencePayload,
      );

      // Drain any buffered photos sent just before this text message
      const buffered = (this.mediaBuffer.get(key) || []).filter(
        (b) => Math.abs(msgTimestamp - b.timestamp) < 300_000,
      );
      this.mediaBuffer.delete(key);

      for (const item of buffered) {
        const nextSlot = SubmissionService.getNextSlot(draft);
        if (!nextSlot) break;
        const attachRes = await this.submissions.attach(key, nextSlot, item);
        draft = attachRes.draft;
      }

      const count = Object.keys(draft.attachments).length;
      if (count === 6) {
        return this.submissions.complete(key);
      }
      return `📝 Draft ${draft.registrationNumber} (${draft.customerName}) siap.${count > 0 ? ` (${count}/6 foto diterima).` : " Kirim 6 foto bukti."}`;
    }

    // Legacy and administrative commands
    if (lower.startsWith(`${prefix}mulai`)) {
      const payload = parseStartCommand(body, this.config.commandPrefix);
      const contact = await message.getContact();
      const senderName = contact.pushname || contact.name || senderId;
      return this.submissions.start(message.from, senderId, senderName, payload);
    }
    if (lower === `${prefix}bantuan` || lower === `${prefix}help`) {
      return help(this.config.commandPrefix);
    }
    if (lower === `${prefix}status`) return this.submissions.status(key);
    if (lower === `${prefix}selesai`) return this.submissions.complete(key);
    if (lower === `${prefix}batal konfirmasi`) return this.submissions.cancel(key);
    if (lower === `${prefix}batal`) {
      throw new InputError(
        `Kirim ${this.config.commandPrefix}batal konfirmasi agar draft tidak terhapus karena salah ketik.`,
      );
    }
    if (lower === `${prefix}idgrup`) {
      return `Nama grup: ${groupName}\nTARGET_GROUP_ID=${message.from}`;
    }
    if (lower.startsWith(`${prefix}hapus `)) {
      const slot = parseAttachmentSlot(body.slice(`${this.config.commandPrefix}hapus `.length));
      if (!slot) {
        throw new InputError(`Label tidak dikenal. Contoh: ${this.config.commandPrefix}hapus dok1`);
      }
      return this.submissions.removeAttachment(key, slot);
    }
    if (lower.startsWith(prefix)) {
      throw new InputError(`Perintah tidak dikenal. Kirim ${this.config.commandPrefix}bantuan.`);
    }
    return undefined;
  }

  public async stop(): Promise<void> {
    try {
      await this.client.destroy();
    } catch {}
  }
}
