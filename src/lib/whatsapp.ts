import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState as getMultiFileAuthState,
  WASocket,
} from "baileys";
import { prisma } from "./prisma";
import path from "path";
import fs from "fs";
import { placeBotOrder } from "./order";
import { createQris, generateOrderId } from "./payments";
import {
  buildInvoiceId,
  formatSuccessCard,
  rupiah,
} from "./format/success-card";

const activeSockets = new Map<string, WASocket>();
const pairingCodes = new Map<string, string>();
const reconnectAttempts = new Map<string, number>();
const reconnectTimers = new Map<string, NodeJS.Timeout>();

const SESSION_DIR = path.join(process.cwd(), ".wa-sessions");
const MAX_RECONNECT_ATTEMPTS = 8;

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function clearReconnect(botId: string) {
  const t = reconnectTimers.get(botId);
  if (t) {
    clearTimeout(t);
    reconnectTimers.delete(botId);
  }
}

function scheduleReconnect(botId: string) {
  const attempts = (reconnectAttempts.get(botId) || 0) + 1;
  reconnectAttempts.set(botId, attempts);
  if (attempts > MAX_RECONNECT_ATTEMPTS) {
    console.warn(
      `[whatsapp] giving up reconnect for ${botId} after ${attempts} attempts`,
    );
    return;
  }
  // Exponential backoff capped at 5 minutes.
  const delay = Math.min(5 * 60_000, 1000 * 2 ** attempts);
  clearReconnect(botId);
  reconnectTimers.set(
    botId,
    setTimeout(() => {
      startWhatsAppBot(botId).catch((err) => {
        console.error(`[whatsapp] reconnect failed for ${botId}:`, err);
        scheduleReconnect(botId);
      });
    }, delay),
  );
}

export async function startWhatsAppBot(botId: string): Promise<string | null> {
  ensureSessionDir();

  const botConfig = await prisma.bot.findUnique({
    where: { id: botId },
    include: { user: true },
  });

  if (!botConfig || botConfig.type !== "whatsapp") {
    throw new Error("Invalid bot configuration");
  }

  if (activeSockets.has(botId)) {
    await stopWhatsAppBot(botId);
  }

  const sessionPath = path.join(SESSION_DIR, botId);
  const { state, saveCreds } = await getMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      activeSockets.delete(botId);
      const statusCode = (
        lastDisconnect?.error as { output?: { statusCode?: number } }
      )?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      await prisma.bot.update({
        where: { id: botId },
        data: { isConnected: false, status: shouldReconnect ? "reconnecting" : "inactive" },
      }).catch(() => {});

      if (shouldReconnect) {
        scheduleReconnect(botId);
      } else {
        reconnectAttempts.delete(botId);
        clearReconnect(botId);
      }
    }

    if (connection === "open") {
      reconnectAttempts.delete(botId);
      clearReconnect(botId);
      await prisma.bot
        .update({
          where: { id: botId },
          data: { isConnected: true, status: "active" },
        })
        .catch(() => {});
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";
      const from = msg.key.remoteJid;
      if (!from || !text) continue;

      // For group messages, the actual sender is in `participant`.
      const sender = msg.key.participant || from;

      try {
        await handleWhatsAppMessage(botId, sock, from, sender, text);
      } catch (err) {
        console.error(`[whatsapp] handler error:`, err);
      }
    }
  });

  activeSockets.set(botId, sock);

  if (!sock.authState.creds.registered && botConfig.phoneNumber) {
    try {
      const code = await sock.requestPairingCode(
        botConfig.phoneNumber.replace(/[^0-9]/g, ""),
      );
      pairingCodes.set(botId, code);
      return code;
    } catch (err) {
      console.error("[whatsapp] pairing code error:", err);
      return null;
    }
  }

  return null;
}

/**
 * Render the `#stock` reply: a BOT AUTO ORDER header followed by one
 * formatted card per active product listing each variation's code, stock,
 * price, and description. Top-3 products by sold count get the BEST SELLER
 * marker. Output is plain text with WhatsApp `*…*` bold markers.
 */
async function formatStockListWA(
  ownerUserId: string,
  contactPerson: string | null,
): Promise<string> {
  const products = await prisma.product.findMany({
    where: { userId: ownerUserId, isActive: true },
    include: {
      variations: {
        where: { isActive: true },
        include: {
          _count: { select: { stocks: { where: { isSold: false } } } },
        },
        orderBy: { price: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  if (products.length === 0) {
    return "Belum ada produk tersedia.";
  }

  // Determine BEST SELLER (top 3 by sold-stock count) per owner.
  const soldCounts = await prisma.stock.groupBy({
    by: ["variationId"],
    where: {
      isSold: true,
      variation: { product: { userId: ownerUserId } },
    },
    _count: { _all: true },
  });
  const variationToProduct = new Map<string, string>();
  for (const p of products) {
    for (const v of p.variations) variationToProduct.set(v.id, p.id);
  }
  const productSold = new Map<string, number>();
  for (const row of soldCounts) {
    const pid = row.variationId
      ? variationToProduct.get(row.variationId)
      : undefined;
    if (!pid) continue;
    productSold.set(pid, (productSold.get(pid) ?? 0) + row._count._all);
  }
  const topProductIds = new Set(
    [...productSold.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .filter(([, c]) => c > 0)
      .map(([pid]) => pid),
  );

  const sections: string[] = [];
  sections.push(
    [
      "*╭────〔 BOT AUTO ORDER 〕─*",
      "*┊・* Untuk membeli Ketik Perintah Berikut",
      "*┊・* #buynow Kode(spasi)JumlahAkun",
      "*┊・* Ex: #buynow spo3b 1",
      "*┊・*",
      "*┊・* Pastikan Code & Jumlah Akun di Ketik dengan benar",
      contactPerson
        ? `*┊・* Contact Admin: ${contactPerson}`
        : "*┊・* Contact Admin: -",
      "*╰┈┈┈┈┈┈┈┈*",
    ].join("\n"),
  );

  for (const p of products) {
    const sold = productSold.get(p.id) ?? 0;
    const isBest = topProductIds.has(p.id);
    const header = isBest
      ? `*╭────〔 ${p.name} \`BEST SELLER\`🔥 〕─*`
      : `*╭────〔 ${p.name} 〕─*`;
    const lines: string[] = [header, `*┊・Stok Terjual:* ${sold}`];
    if (p.variations.length === 0) {
      lines.push("*┊*____________________");
      lines.push("*┊・* Belum ada variasi tersedia.");
    } else {
      for (const v of p.variations) {
        lines.push("*┊*____________________");
        lines.push(`*┊・Variasi:* ${v.name}`);
        lines.push(`*┊・Kode:* ${v.code}`);
        lines.push(`*┊・Stok Tersedia:* ${v._count.stocks}`);
        lines.push(`*┊・Harga:* Rp. ${rupiah(v.price)}`);
        lines.push(`*┊・Desc:* ${p.description ?? "-"}`);
      }
    }
    lines.push("*┊*____________________");
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

function parseJidList(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isAuthorisedSender(
  sender: string,
  ownerJids: string | null,
  adminJids: string | null,
): "owner" | "admin" | null {
  const s = sender.toLowerCase();
  const owners = parseJidList(ownerJids);
  if (owners.has(s)) return "owner";
  const admins = parseJidList(adminJids);
  if (admins.has(s)) return "admin";
  return null;
}

/**
 * Find or create a Customer keyed by `(ownerUserId, jid)`. The unique
 * constraint protects against duplicate creates across concurrent messages.
 */
async function getOrCreateCustomer(
  ownerUserId: string,
  botId: string,
  jid: string,
): Promise<{
  id: string;
  balance: number;
  status: string;
  name: string | null;
}> {
  const existing = await prisma.customer.findUnique({
    where: { ownerUserId_jid: { ownerUserId, jid } },
    select: { id: true, balance: true, status: true, name: true },
  });
  if (existing) return existing;

  try {
    const created = await prisma.customer.create({
      data: { ownerUserId, botId, jid, name: null },
      select: { id: true, balance: true, status: true, name: true },
    });
    return created;
  } catch {
    const fallback = await prisma.customer.findUnique({
      where: { ownerUserId_jid: { ownerUserId, jid } },
      select: { id: true, balance: true, status: true, name: true },
    });
    if (!fallback) throw new Error("Customer create gagal");
    return fallback;
  }
}

async function handleWhatsAppMessage(
  botId: string,
  sock: WASocket,
  from: string,
  sender: string,
  text: string,
) {
  const botConfig = await prisma.bot.findUnique({
    where: { id: botId },
    select: {
      id: true,
      userId: true,
      isAutoOrder: true,
      welcomeMsg: true,
      name: true,
      contactPerson: true,
      ownerJids: true,
      adminJids: true,
      qrisServerId: true,
    },
  });
  if (!botConfig) return;

  const isGroup = from.endsWith("@g.us");
  const trimmed = text.trim();
  const cmd = trimmed.toLowerCase();

  // /bc broadcast — owner/admin only, sent to all participating groups.
  if (cmd.startsWith("/bc") || cmd === "bc" || cmd.startsWith("bc ")) {
    const role = isAuthorisedSender(
      sender,
      botConfig.ownerJids,
      botConfig.adminJids,
    );
    if (!role) {
      await sock.sendMessage(from, {
        text: "Maaf, hanya owner/admin bot yang bisa /bc.",
      });
      return;
    }
    const message = trimmed.replace(/^\/?bc\s*/i, "").trim();
    if (!message) {
      await sock.sendMessage(from, {
        text: "Format: /bc <pesan>\nContoh: /bc Promo akhir pekan diskon 50%",
      });
      return;
    }
    let groups: Record<string, { subject: string }> = {};
    try {
      groups = (await sock.groupFetchAllParticipating()) as Record<
        string,
        { subject: string }
      >;
    } catch (err) {
      console.error("[whatsapp] groupFetchAllParticipating failed:", err);
    }
    const targets = Object.keys(groups);
    if (targets.length === 0) {
      await sock.sendMessage(from, {
        text: "Bot belum tergabung di grup manapun.",
      });
      return;
    }
    const broadcast = await prisma.broadcast.create({
      data: {
        botId,
        message,
        targets: JSON.stringify(targets),
        status: "pending",
      },
    });
    let success = 0;
    for (const gid of targets) {
      try {
        await sock.sendMessage(gid, { text: message });
        success += 1;
      } catch (err) {
        console.error(`[whatsapp] /bc to ${gid} failed:`, err);
      }
    }
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: "sent", sentAt: new Date() },
    });
    await sock.sendMessage(from, {
      text: `Broadcast terkirim ke ${success}/${targets.length} grup.`,
    });
    return;
  }

  // #stock works everywhere — both groups and private chats.
  if (
    cmd === "#stock" ||
    cmd === "/stock" ||
    cmd === "stock"
  ) {
    const reply = await formatStockListWA(
      botConfig.userId,
      botConfig.contactPerson,
    );
    await sock.sendMessage(from, { text: reply });
    return;
  }

  // Customer-facing commands below this line are private-chat only.
  if (isGroup) {
    // For #buynow / #buy in group, redirect the buyer to a private chat so
    // we never expose account data to the rest of the group.
    if (
      cmd.startsWith("#buynow") ||
      cmd.startsWith("#buy") ||
      cmd.startsWith("/buy") ||
      cmd.startsWith("/buynow") ||
      cmd.startsWith("#topup") ||
      cmd.startsWith("/topup")
    ) {
      await sock.sendMessage(from, {
        text: "Untuk pembelian / topup, silakan kirim pesan ke private chat saya.",
      });
    }
    return;
  }

  const customer = await getOrCreateCustomer(botConfig.userId, botId, sender);
  if (customer.status !== "active") {
    await sock.sendMessage(from, {
      text: "Akun Anda dinonaktifkan oleh admin.",
    });
    return;
  }

  if (
    cmd === "/start" ||
    cmd === "#start" ||
    cmd === "halo" ||
    cmd === "hi" ||
    cmd === "hello"
  ) {
    const welcome =
      botConfig.welcomeMsg ||
      `Selamat datang di ${botConfig.name}!\n\nKetik *menu* untuk lihat produk\n*/saldo* untuk cek saldo\n*/buy KODE [QTY]* untuk beli pakai saldo\n*/buynow KODE [QTY]* untuk beli langsung pakai QRIS`;
    await sock.sendMessage(from, { text: welcome });
    return;
  }

  if (cmd === "menu" || cmd === "/menu" || cmd === "#menu") {
    const categories = await prisma.category.findMany({
      where: { userId: botConfig.userId, isActive: true },
      include: {
        products: {
          where: { isActive: true },
          include: {
            variations: {
              where: { isActive: true },
              include: {
                _count: { select: { stocks: { where: { isSold: false } } } },
              },
            },
          },
        },
      },
    });

    if (categories.length === 0) {
      await sock.sendMessage(from, { text: "Belum ada produk tersedia." });
      return;
    }

    let reply = "📦 *Daftar Produk*\n\n";
    for (const cat of categories) {
      reply += `📁 *${cat.name}*\n`;
      for (const prod of cat.products) {
        const totalStock = prod.variations.reduce(
          (sum, v) => sum + v._count.stocks,
          0,
        );
        reply += `  ├ ${prod.name} - Rp ${prod.price.toLocaleString(
          "id-ID",
        )} (Stock: ${totalStock})\n`;
        for (const v of prod.variations) {
          reply += `  │  └ ${v.name} [${v.code}] - Rp ${v.price.toLocaleString(
            "id-ID",
          )} (${v._count.stocks})\n`;
        }
      }
      reply += "\n";
    }
    reply +=
      "Order pakai saldo: */buy KODE [QTY]*\nOrder pakai QRIS: */buynow KODE [QTY]*\nCek saldo: */saldo*";
    await sock.sendMessage(from, { text: reply });
    return;
  }

  if (cmd === "/saldo" || cmd === "saldo" || cmd === "#saldo") {
    const fresh = await prisma.customer.findUnique({
      where: { id: customer.id },
      select: { balance: true },
    });
    await sock.sendMessage(from, {
      text: `💰 Saldo Anda: Rp ${(fresh?.balance ?? 0).toLocaleString("id-ID")}\n\nIsi saldo: */topup NOMINAL*`,
    });
    return;
  }

  if (cmd.startsWith("order ") || cmd.startsWith("/order ")) {
    if (!botConfig.isAutoOrder) {
      await sock.sendMessage(from, {
        text: "Auto order tidak aktif. Hubungi admin.",
      });
      return;
    }

    const parts = trimmed.split(/\s+/).slice(1);
    if (parts.length < 1) {
      await sock.sendMessage(from, {
        text: "Format: *order [kode] [jumlah] [voucher]*\nContoh: order NETFLIX1 1 PROMO10",
      });
      return;
    }

    const code = parts[0]!;
    const qty = parseInt(parts[1] || "1");
    const voucherCode = parts[2] || undefined;

    const result = await placeBotOrder({
      ownerUserId: botConfig.userId,
      code,
      qty,
      source: "whatsapp",
      voucherCode,
      customerId: customer.id,
    });

    if (!result.ok) {
      await sock.sendMessage(from, { text: result.error });
      return;
    }

    const lines = [
      `✅ *Order Berhasil!*`,
      ``,
      `Produk: ${result.productName}`,
      `Variasi: ${result.variationName}`,
      `Jumlah: ${qty}`,
      `Subtotal: Rp ${result.subtotal.toLocaleString("id-ID")}`,
    ];
    if (result.discount > 0) {
      lines.push(
        `Voucher (${result.voucherCode || ""}): -Rp ${result.discount.toLocaleString("id-ID")}`,
      );
    }
    lines.push(
      `Total: Rp ${result.totalPrice.toLocaleString("id-ID")}`,
      ``,
      `📋 *Data Akun:*\n${result.accountData}`,
    );

    await sock.sendMessage(from, { text: lines.join("\n") });
    return;
  }

  // /buy KODE [QTY] [VOUCHER] — pay from Customer balance.
  if (
    cmd.startsWith("/buy ") ||
    cmd.startsWith("#buy ") ||
    cmd.startsWith("buy ")
  ) {
    if (!botConfig.isAutoOrder) {
      await sock.sendMessage(from, {
        text: "Auto order tidak aktif. Hubungi admin.",
      });
      return;
    }
    const parts = trimmed.split(/\s+/).slice(1);
    if (parts.length < 1) {
      await sock.sendMessage(from, {
        text: "Format: */buy KODE [QTY] [VOUCHER]*\nContoh: */buy NETFLIX1 1*",
      });
      return;
    }
    const code = parts[0]!;
    const qty = parseInt(parts[1] || "1");
    const voucherCode = parts[2] || undefined;

    const result = await placeBotOrder({
      ownerUserId: botConfig.userId,
      code,
      qty,
      source: "whatsapp",
      voucherCode,
      customerId: customer.id,
      paymentMode: "balance",
    });
    if (!result.ok) {
      await sock.sendMessage(from, { text: `❌ ${result.error}` });
      return;
    }
    const [fresh, fullCustomer] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: customer.id },
        select: { balance: true },
      }),
      prisma.customer.findUnique({
        where: { id: customer.id },
        select: {
          id: true,
          createdAt: true,
          chatId: true,
        },
      }),
    ]);
    const buyerNumber = fullCustomer
      ? await prisma.customer.count({
          where: {
            ownerUserId: botConfig.userId,
            createdAt: { lte: fullCustomer.createdAt },
          },
        })
      : 1;
    const card = formatSuccessCard({
      invoiceId: buildInvoiceId(result.orderId, "AKH"),
      buyerNumber,
      telegramId: fullCustomer?.chatId ?? null,
      telegramUsername: null,
      productName: result.productName,
      variationName: result.variationName,
      quantity: qty,
      amount: result.subtotal,
      fee: 0,
      total: result.totalPrice,
      method: "Saldo",
      accountData: result.accountData,
    });
    const trailer = `\n\nSisa Saldo: Rp ${rupiah(fresh?.balance ?? 0)}`;
    await sock.sendMessage(from, { text: card + trailer });
    return;
  }

  // /buynow KODE [QTY] — generate a QRIS via the configured gateway.
  if (
    cmd.startsWith("/buynow ") ||
    cmd.startsWith("#buynow ") ||
    cmd.startsWith("buynow ")
  ) {
    if (!botConfig.isAutoOrder) {
      await sock.sendMessage(from, {
        text: "Auto order tidak aktif. Hubungi admin.",
      });
      return;
    }
    if (!botConfig.qrisServerId) {
      await sock.sendMessage(from, {
        text: "QRIS belum diatur untuk bot ini. Hubungi admin.",
      });
      return;
    }
    const parts = trimmed.split(/\s+/).slice(1);
    if (parts.length < 1) {
      await sock.sendMessage(from, { text: "Format: */buynow KODE [QTY]*" });
      return;
    }
    const code = parts[0]!;
    const qty = parseInt(parts[1] || "1");
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100) {
      await sock.sendMessage(from, { text: "Jumlah tidak valid (1-100)" });
      return;
    }

    const variation = await prisma.productVariation.findFirst({
      where: {
        code,
        isActive: true,
        product: { userId: botConfig.userId, isActive: true },
      },
      include: {
        product: { select: { name: true } },
        _count: { select: { stocks: { where: { isSold: false } } } },
      },
    });
    if (!variation) {
      await sock.sendMessage(from, { text: "Produk tidak ditemukan." });
      return;
    }
    if (variation._count.stocks < qty) {
      await sock.sendMessage(from, {
        text: `Stock tidak cukup. Tersedia: ${variation._count.stocks}`,
      });
      return;
    }
    const amount = variation.price * qty;
    const server = await prisma.qrisServer.findUnique({
      where: { id: botConfig.qrisServerId },
    });
    if (!server || !server.isActive) {
      await sock.sendMessage(from, { text: "QRIS tidak aktif." });
      return;
    }

    const orderId = generateOrderId("BN");
    const created = await createQris(server, { amount, orderId });
    if (!created.ok) {
      await sock.sendMessage(from, {
        text: `❌ Gagal generate QRIS: ${created.error}`,
      });
      return;
    }

    await prisma.payment.create({
      data: {
        ownerUserId: botConfig.userId,
        customerId: customer.id,
        botId,
        qrisServerId: server.id,
        provider: server.provider,
        orderId,
        amount,
        fee: created.fee,
        totalAmount: created.totalAmount,
        status: "pending",
        qrString: created.qrString,
        paymentUrl: created.paymentUrl,
        productCode: code,
        qty,
        purpose: "buynow",
        expiresAt: created.expiresAt,
        rawResponse: JSON.stringify(created.raw ?? null),
      },
    });

    const lines = [
      `🧾 *QRIS Pembayaran*`,
      ``,
      `Produk: ${variation.product.name} - ${variation.name}`,
      `Jumlah: ${qty}`,
      `Total: Rp ${created.totalAmount.toLocaleString("id-ID")}`,
      `Order ID: ${orderId}`,
      ``,
    ];
    if (created.paymentUrl) lines.push(`Bayar di: ${created.paymentUrl}`);
    if (created.qrString) lines.push(`QR String:\n${created.qrString}`);
    if (created.expiresAt) {
      lines.push(
        ``,
        `⏰ Expired: ${created.expiresAt.toLocaleString("id-ID")}`,
      );
    }
    lines.push(``, `Setelah bayar, akun akan otomatis terkirim.`);
    await sock.sendMessage(from, { text: lines.join("\n") });
    return;
  }

  // /topup NOMINAL — generate a QRIS for crediting customer balance.
  if (
    cmd.startsWith("/topup") ||
    cmd.startsWith("#topup") ||
    cmd.startsWith("topup")
  ) {
    if (!botConfig.qrisServerId) {
      await sock.sendMessage(from, {
        text: "QRIS belum diatur untuk bot ini. Hubungi admin.",
      });
      return;
    }
    const parts = trimmed.split(/\s+/).slice(1);
    const amount = parseInt((parts[0] || "").replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(amount) || amount < 1000 || amount > 10_000_000) {
      await sock.sendMessage(from, {
        text: "Format: */topup NOMINAL*\nMinimal Rp 1.000, maksimal Rp 10.000.000",
      });
      return;
    }
    const server = await prisma.qrisServer.findUnique({
      where: { id: botConfig.qrisServerId },
    });
    if (!server || !server.isActive) {
      await sock.sendMessage(from, { text: "QRIS tidak aktif." });
      return;
    }
    const orderId = generateOrderId("TP");
    const created = await createQris(server, { amount, orderId });
    if (!created.ok) {
      await sock.sendMessage(from, {
        text: `❌ Gagal generate QRIS: ${created.error}`,
      });
      return;
    }
    await prisma.payment.create({
      data: {
        ownerUserId: botConfig.userId,
        customerId: customer.id,
        botId,
        qrisServerId: server.id,
        provider: server.provider,
        orderId,
        amount,
        fee: created.fee,
        totalAmount: created.totalAmount,
        status: "pending",
        qrString: created.qrString,
        paymentUrl: created.paymentUrl,
        purpose: "topup",
        expiresAt: created.expiresAt,
        rawResponse: JSON.stringify(created.raw ?? null),
      },
    });
    const lines = [
      `🧾 *QRIS Topup Saldo*`,
      ``,
      `Nominal: Rp ${amount.toLocaleString("id-ID")}`,
      `Total: Rp ${created.totalAmount.toLocaleString("id-ID")}`,
      `Order ID: ${orderId}`,
      ``,
    ];
    if (created.paymentUrl) lines.push(`Bayar di: ${created.paymentUrl}`);
    if (created.qrString) lines.push(`QR String:\n${created.qrString}`);
    if (created.expiresAt) {
      lines.push(
        ``,
        `⏰ Expired: ${created.expiresAt.toLocaleString("id-ID")}`,
      );
    }
    lines.push(``, `Saldo akan otomatis bertambah setelah bayar.`);
    await sock.sendMessage(from, { text: lines.join("\n") });
    return;
  }

  if (cmd === "help" || cmd === "/help" || cmd === "#help") {
    const contact = botConfig.contactPerson
      ? `\n\n📞 Contact: ${botConfig.contactPerson}`
      : "";
    await sock.sendMessage(from, {
      text:
        "📌 *Perintah Bot:*\n\n" +
        "*menu* - Lihat produk\n" +
        "*/buy KODE [QTY]* - Beli pakai saldo\n" +
        "*/buynow KODE [QTY]* - Beli langsung pakai QRIS\n" +
        "*/saldo* - Cek saldo\n" +
        "*/topup NOMINAL* - Isi saldo via QRIS\n" +
        "*help* - Bantuan" +
        contact,
    });
    return;
  }
}

export async function stopWhatsAppBot(botId: string) {
  clearReconnect(botId);
  reconnectAttempts.delete(botId);
  const sock = activeSockets.get(botId);
  if (sock) {
    await sock.logout().catch(() => {});
    activeSockets.delete(botId);
  }
  pairingCodes.delete(botId);
  await prisma.bot
    .update({
      where: { id: botId },
      data: { isConnected: false, status: "inactive" },
    })
    .catch(() => {});
}

export async function sendWhatsAppBroadcast(
  botId: string,
  message: string,
  targets: string[],
) {
  const sock = activeSockets.get(botId);
  if (!sock) throw new Error("Bot belum terhubung");

  const results = [];
  for (const target of targets) {
    try {
      const jid = target.includes("@") ? target : `${target}@s.whatsapp.net`;
      await sock.sendMessage(jid, { text: message });
      results.push({ target, success: true });
    } catch (err) {
      results.push({ target, success: false, error: String(err) });
    }
  }
  return results;
}

/**
 * List groups the bot is currently a participant of. Used by the web UI's
 * broadcast page to display target groups. Returns `[]` if the bot is not
 * running.
 */
export async function listJoinedGroups(
  botId: string,
): Promise<{ id: string; subject: string }[]> {
  const sock = activeSockets.get(botId);
  if (!sock) return [];
  try {
    const groups = (await sock.groupFetchAllParticipating()) as Record<
      string,
      { subject?: string }
    >;
    return Object.entries(groups).map(([id, g]) => ({
      id,
      subject: g.subject || id,
    }));
  } catch (err) {
    console.error("[whatsapp] listJoinedGroups failed:", err);
    return [];
  }
}

/**
 * Push a message to a customer JID from a bot context. Used by the payment
 * webhook handler to notify the customer once their QRIS is settled. Returns
 * false if the bot is not currently connected.
 */
export async function notifyCustomerByJid(
  botId: string,
  jid: string,
  text: string,
): Promise<boolean> {
  const sock = activeSockets.get(botId);
  if (!sock) return false;
  try {
    await sock.sendMessage(jid, { text });
    return true;
  } catch (err) {
    console.error("[whatsapp] notifyCustomerByJid failed:", err);
    return false;
  }
}

export function getPairingCode(botId: string): string | null {
  return pairingCodes.get(botId) || null;
}

export function isWhatsAppConnected(botId: string): boolean {
  return activeSockets.has(botId);
}
