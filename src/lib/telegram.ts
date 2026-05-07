import {
  Bot as GrammyBot,
  GrammyError,
  HttpError,
  InlineKeyboard,
  type Context,
} from "grammy";
import { prisma } from "./prisma";
import { placeBotOrder } from "./order";
import { createQris, generateOrderId } from "./payments";
import {
  buildInvoiceId,
  formatSuccessCard,
} from "./format/success-card";

const activeBots = new Map<string, GrammyBot>();

const PAGE_SIZE = 10;

// --- Formatting helpers ----------------------------------------------------

const DAY_NAMES_ID = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** "Kamis, 07 Mei 2026 12:36:55" — Indonesian long-form date. */
function formatDateID(d: Date = new Date()): string {
  const day = DAY_NAMES_ID[d.getDay()] ?? "";
  const month = MONTH_NAMES_ID[d.getMonth()] ?? "";
  return `${day}, ${pad2(d.getDate())} ${month} ${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** "11:10:29 AM" — short clock used as a footer. */
function formatTimeID(d: Date = new Date()): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function rupiah(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** Escape a string for Telegram HTML parse mode. */
function escHtml(text: string | number | null | undefined): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Customer helpers ------------------------------------------------------

/**
 * Find or create a Customer keyed by `(ownerUserId, chatId)` for Telegram.
 * Mirrors the WhatsApp flow but keys on the numeric Telegram chat id instead
 * of a JID.
 */
async function getOrCreateTelegramCustomer(
  ownerUserId: string,
  botId: string,
  chatId: string,
  name: string | null,
): Promise<{
  id: string;
  balance: number;
  status: string;
  name: string | null;
}> {
  const existing = await prisma.customer.findUnique({
    where: { ownerUserId_chatId: { ownerUserId, chatId } },
    select: { id: true, balance: true, status: true, name: true },
  });
  if (existing) return existing;
  try {
    const created = await prisma.customer.create({
      data: { ownerUserId, botId, chatId, name },
      select: { id: true, balance: true, status: true, name: true },
    });
    return created;
  } catch {
    const fallback = await prisma.customer.findUnique({
      where: { ownerUserId_chatId: { ownerUserId, chatId } },
      select: { id: true, balance: true, status: true, name: true },
    });
    if (!fallback) throw new Error("Customer create gagal");
    return fallback;
  }
}

// --- Stat helpers ----------------------------------------------------------

/**
 * Aggregated bot-wide stats shown at the top of /start. Counts items sold
 * (via Stock.isSold), total revenue, and how many customers this bot has.
 */
async function getBotStats(ownerUserId: string, botId: string) {
  const [sold, revenueAgg, totalUsers] = await Promise.all([
    prisma.stock.count({
      where: {
        isSold: true,
        variation: { product: { userId: ownerUserId } },
      },
    }),
    prisma.order.aggregate({
      where: { userId: ownerUserId, status: "completed" },
      _sum: { totalPrice: true },
    }),
    prisma.customer.count({ where: { ownerUserId, botId } }),
  ]);
  return {
    sold,
    totalRevenue: revenueAgg._sum.totalPrice ?? 0,
    totalUsers,
  };
}

/** Per-customer rolling stats — total spent, items bought, current balance. */
async function getCustomerStats(customerId: string) {
  const [orderRows, customer] = await Promise.all([
    prisma.customerOrder.findMany({
      where: { customerId },
      select: { orderId: true },
    }),
    prisma.customer.findUnique({
      where: { id: customerId },
      select: { balance: true },
    }),
  ]);
  if (orderRows.length === 0) {
    return { transaksi: 0, produkDibeli: 0, balance: customer?.balance ?? 0 };
  }
  const ids = orderRows.map((o) => o.orderId);
  const agg = await prisma.order.aggregate({
    where: { id: { in: ids }, status: "completed" },
    _sum: { totalPrice: true, quantity: true },
  });
  return {
    transaksi: agg._sum.totalPrice ?? 0,
    produkDibeli: agg._sum.quantity ?? 0,
    balance: customer?.balance ?? 0,
  };
}

// --- View renderers --------------------------------------------------------

interface WelcomeArgs {
  botName: string;
  customWelcome: string | null;
  user: {
    id: string | number;
    username: string | null;
    firstName: string | null;
  };
  customerStats: { transaksi: number; produkDibeli: number; balance: number };
  botStats: { sold: number; totalRevenue: number; totalUsers: number };
}

function renderWelcome({
  botName,
  customWelcome,
  user,
  customerStats,
  botStats,
}: WelcomeArgs): string {
  const handle = user.username
    ? `@${user.username}`
    : (user.firstName ?? "kak");
  const lines: string[] = [];
  if (customWelcome && customWelcome.trim()) {
    lines.push(escHtml(customWelcome.trim()));
    lines.push("");
  }
  lines.push(`<b>Halo kak ${escHtml(handle)} 👋🏼</b>`);
  lines.push(escHtml(formatDateID()));
  lines.push("");
  lines.push("<b>User Info :</b>");
  lines.push(`└ ID : <code>${escHtml(user.id)}</code>`);
  lines.push(
    `└ Username : <code>${escHtml(user.username ? `@${user.username}` : "-")}</code>`,
  );
  lines.push(`└ Transaksi: ${escHtml(rupiah(customerStats.transaksi))}`);
  lines.push(`└ Produk dibeli : ${customerStats.produkDibeli}x`);
  lines.push(`└ Saldo Pengguna : ${escHtml(rupiah(customerStats.balance))}`);
  lines.push("");
  lines.push(`<b>BOT Stats (${escHtml(botName)}):</b>`);
  lines.push(`└ Terjual : ${botStats.sold} pcs`);
  lines.push(`└ Total Transaksi : ${escHtml(rupiah(botStats.totalRevenue))}`);
  lines.push(`└ Total User : ${botStats.totalUsers}`);
  lines.push("");
  lines.push("<b>Shortcuts :</b>");
  lines.push("/start – Mulai bot");
  lines.push("/stock – Cek stok produk");
  lines.push("/saldo – Cek saldo");
  lines.push("/topproduk – Produk Populer");
  return lines.join("\n");
}

interface ListView {
  text: string;
  kb: InlineKeyboard;
}

async function renderProductList(
  ownerUserId: string,
  page: number,
): Promise<ListView> {
  const products = await prisma.product.findMany({
    where: { userId: ownerUserId, isActive: true },
    select: {
      id: true,
      name: true,
      variations: {
        where: { isActive: true },
        select: {
          _count: { select: { stocks: { where: { isSold: false } } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = products.slice(start, start + PAGE_SIZE);

  const lines: string[] = ["<b>LIST PRODUK</b>", ""];
  if (slice.length === 0) {
    lines.push("Belum ada produk tersedia.");
  } else {
    slice.forEach((p, i) => {
      const stock = p.variations.reduce((s, v) => s + v._count.stocks, 0);
      lines.push(`[${start + i + 1}]. ${escHtml(p.name)} ( ${stock} )`);
    });
  }
  lines.push("");
  lines.push(`📄 Halaman ${safePage} / ${totalPages}`);
  lines.push(`📆 ${formatTimeID()}`);

  const kb = new InlineKeyboard();
  // Numbered product buttons (5 per row).
  slice.forEach((p, i) => {
    kb.text(String(start + i + 1), `n:p:${p.id}`);
    if ((i + 1) % 5 === 0) kb.row();
  });
  if (slice.length % 5 !== 0) kb.row();

  // Pagination row.
  if (safePage > 1) kb.text("« Prev", `n:l:${safePage - 1}`);
  kb.text(`📄 ${safePage}/${totalPages}`, "noop");
  if (safePage < totalPages) kb.text("Next »", `n:l:${safePage + 1}`);
  kb.row();

  // Quick actions.
  kb.text("💰 Saldo", "act:saldo").text("📊 Top Produk", "act:top");

  return { text: lines.join("\n"), kb };
}

async function renderProductDetail(
  ownerUserId: string,
  productId: string,
): Promise<ListView | null> {
  const p = await prisma.product.findFirst({
    where: { id: productId, userId: ownerUserId, isActive: true },
    include: {
      variations: {
        where: { isActive: true },
        include: {
          _count: { select: { stocks: { where: { isSold: false } } } },
        },
        orderBy: { price: "asc" },
      },
    },
  });
  if (!p) return null;

  const soldCount = await prisma.stock.count({
    where: { isSold: true, variation: { productId: p.id } },
  });

  const lines: string[] = [];
  lines.push("tambahkan jumlah pembelian:");
  lines.push("<code>╭───────────────</code>");
  lines.push(`<code>┊</code>・Produk : ${escHtml(p.name)}`);
  lines.push(`<code>┊</code>・Stok Terjual : ${soldCount}`);
  lines.push(`<code>┊</code>・Desk : ${escHtml(p.description ?? "-")}`);
  lines.push("<code>╰───────────────</code>");
  lines.push("<code>╭───────────────</code>");
  lines.push("<code>┊</code> Variasi, Harga - (Stok):");
  for (const v of p.variations) {
    lines.push(
      `<code>┊</code>・${escHtml(v.name)}: ${escHtml(rupiah(v.price))} - (${v._count.stocks})`,
    );
  }
  lines.push("<code>╰───────────────</code>");
  lines.push("");
  lines.push(`Current Date: ${formatTimeID()}`);

  const kb = new InlineKeyboard();
  if (p.variations.length === 0) {
    kb.text("Tidak ada variasi", "noop").row();
  } else {
    for (const v of p.variations) {
      const label = `${v.name} - ${rupiah(v.price)} (${v._count.stocks})`;
      kb.text(label.slice(0, 60), `n:v:${v.id}`).row();
    }
  }
  kb.text("« Kembali", "n:l:1");

  return { text: lines.join("\n"), kb };
}

async function renderVariationDetail(
  ownerUserId: string,
  variationId: string,
  qty: number,
): Promise<ListView | null> {
  const v = await prisma.productVariation.findFirst({
    where: {
      id: variationId,
      isActive: true,
      product: { userId: ownerUserId, isActive: true },
    },
    include: {
      product: true,
      _count: { select: { stocks: { where: { isSold: false } } } },
    },
  });
  if (!v) return null;

  const stockLeft = v._count.stocks;
  const minQty = stockLeft > 0 ? 1 : 0;
  const safeQty = Math.max(
    minQty,
    Math.min(Number.isFinite(qty) ? qty : 1, Math.max(stockLeft, 1)),
  );
  const total = v.price * safeQty;

  const lines: string[] = [];
  lines.push("tambahkan jumlah pembelian:");
  lines.push("<code>╭───────────────</code>");
  lines.push(`<code>┊</code>・Produk : ${escHtml(v.product.name)}`);
  lines.push(`<code>┊</code>・Variasi : ${escHtml(v.name)}`);
  lines.push(`<code>┊</code>・Kode : <code>${escHtml(v.code)}</code>`);
  lines.push(`<code>┊</code>・Sisa Produk : ${stockLeft}`);
  lines.push(
    `<code>┊</code>・Desk : ${escHtml(v.product.description ?? "-")}`,
  );
  lines.push("<code>╰───────────────</code>");
  lines.push("<code>╭───────────────</code>");
  lines.push(`<code>┊</code>・Jumlah : ${safeQty}`);
  lines.push(`<code>┊</code>・Harga : ${escHtml(rupiah(v.price))}`);
  lines.push(`<code>┊</code>・Total Harga : ${escHtml(rupiah(total))}`);
  lines.push("<code>╰───────────────</code>");
  lines.push("");
  lines.push(`Current Date: ${formatTimeID()}`);

  const kb = new InlineKeyboard();
  // Qty -, qty display, qty +
  const downQty = Math.max(1, safeQty - 1);
  const upQty = Math.min(Math.max(stockLeft, 1), safeQty + 1);
  kb.text("➖", `q:${v.id}:${downQty}`)
    .text(`${safeQty}`, "noop")
    .text("➕", `q:${v.id}:${upQty}`)
    .row();
  if (stockLeft >= safeQty && safeQty > 0) {
    kb.text("💰 Buy (Saldo)", `b:${v.id}:${safeQty}`)
      .text("💎 Buy Now (QRIS)", `bn:${v.id}:${safeQty}`)
      .row();
  } else {
    kb.text("Stok habis", "noop").row();
  }
  kb.text("« Kembali ke Produk", `n:p:${v.product.id}`);
  return { text: lines.join("\n"), kb };
}

async function renderTopProducts(ownerUserId: string): Promise<ListView> {
  // Group orders by variation, sum quantity.
  const grouped = await prisma.order.groupBy({
    by: ["variationId"],
    where: {
      userId: ownerUserId,
      status: "completed",
      variationId: { not: null },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 10,
  });
  const variationIds = grouped
    .map((g) => g.variationId)
    .filter((x): x is string => !!x);
  const variations = await prisma.productVariation.findMany({
    where: { id: { in: variationIds } },
    include: { product: { select: { id: true, name: true } } },
  });
  const byId = new Map(variations.map((v) => [v.id, v]));

  const lines: string[] = ["<b>📊 Top Produk Terlaris</b>", ""];
  if (grouped.length === 0) {
    lines.push("Belum ada penjualan.");
  } else {
    grouped.forEach((row, idx) => {
      const v = row.variationId ? byId.get(row.variationId) : undefined;
      if (!v) return;
      lines.push(
        `${idx + 1}. ${escHtml(v.product.name)} – ${escHtml(v.name)} (${row._sum.quantity ?? 0} terjual)`,
      );
    });
  }
  lines.push("");
  lines.push(`📆 ${formatTimeID()}`);

  const kb = new InlineKeyboard().text("« Kembali", "n:l:1");
  return { text: lines.join("\n"), kb };
}

// --- Inline-button buy actions --------------------------------------------

async function executeBuyWithBalance(
  ownerUserId: string,
  botId: string,
  chatId: string,
  userName: string | null,
  variationId: string,
  qty: number,
): Promise<string> {
  const variation = await prisma.productVariation.findFirst({
    where: {
      id: variationId,
      isActive: true,
      product: { userId: ownerUserId, isActive: true },
    },
    select: { code: true },
  });
  if (!variation) return "❌ Produk tidak ditemukan";

  const customer = await getOrCreateTelegramCustomer(
    ownerUserId,
    botId,
    chatId,
    userName,
  );
  const result = await placeBotOrder({
    ownerUserId,
    code: variation.code,
    qty,
    source: "telegram",
    customerId: customer.id,
    paymentMode: "balance",
  });
  if (!result.ok) return `❌ ${result.error}`;
  const [fresh, fullCustomer] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customer.id },
      select: { balance: true },
    }),
    prisma.customer.findUnique({
      where: { id: customer.id },
      select: { id: true, createdAt: true, email: true, phone: true, chatId: true },
    }),
  ]);
  const buyerNumber = fullCustomer
    ? await prisma.customer.count({
        where: { ownerUserId, createdAt: { lte: fullCustomer.createdAt } },
      })
    : 1;
  const card = formatSuccessCard({
    invoiceId: buildInvoiceId(result.orderId, "AKH"),
    buyerNumber,
    telegramId: fullCustomer?.chatId ?? null,
    telegramUsername: userName ?? null,
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
  return card + trailer;
}

async function executeBuyNow(
  ownerUserId: string,
  botId: string,
  qrisServerId: string | null,
  chatId: string,
  userName: string | null,
  variationId: string,
  qty: number,
): Promise<string> {
  if (!qrisServerId) return "QRIS belum diatur untuk bot ini. Hubungi admin.";
  const variation = await prisma.productVariation.findFirst({
    where: {
      id: variationId,
      isActive: true,
      product: { userId: ownerUserId, isActive: true },
    },
    include: {
      product: { select: { name: true } },
      _count: { select: { stocks: { where: { isSold: false } } } },
    },
  });
  if (!variation) return "Produk tidak ditemukan.";
  if (variation._count.stocks < qty) {
    return `Stock tidak cukup. Tersedia: ${variation._count.stocks}`;
  }
  const amount = variation.price * qty;
  const server = await prisma.qrisServer.findUnique({
    where: { id: qrisServerId },
  });
  if (!server || !server.isActive) return "QRIS tidak aktif.";

  const customer = await getOrCreateTelegramCustomer(
    ownerUserId,
    botId,
    chatId,
    userName,
  );
  const orderId = generateOrderId("BN");
  const created = await createQris(server, { amount, orderId });
  if (!created.ok) return `❌ Gagal generate QRIS: ${created.error}`;

  await prisma.payment.create({
    data: {
      ownerUserId,
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
      productCode: variation.code,
      qty,
      purpose: "buynow",
      expiresAt: created.expiresAt,
      rawResponse: JSON.stringify(created.raw ?? null),
    },
  });

  const lines = [
    "🧾 QRIS Pembayaran",
    "",
    `Produk: ${variation.product.name} - ${variation.name}`,
    `Jumlah: ${qty}`,
    `Total: ${rupiah(created.totalAmount)}`,
    `Order ID: ${orderId}`,
    "",
  ];
  if (created.paymentUrl) lines.push(`Bayar di: ${created.paymentUrl}`);
  if (created.qrString) lines.push(`QR String:\n${created.qrString}`);
  if (created.expiresAt) {
    lines.push("", `⏰ Expired: ${created.expiresAt.toLocaleString("id-ID")}`);
  }
  lines.push("", "Setelah bayar, akun akan otomatis terkirim.");
  return lines.join("\n");
}

// --- Bot lifecycle ---------------------------------------------------------

interface BotConfig {
  id: string;
  userId: string;
  name: string;
  token: string | null;
  type: string;
  isAutoOrder: boolean;
  contactPerson: string | null;
  welcomeMsg: string | null;
  startBanner: string | null;
  qrisServerId: string | null;
}

async function sendStart(ctx: Context, botConfig: BotConfig) {
  const chatId = String(ctx.chat?.id ?? "");
  const fromUser = ctx.from;
  if (!chatId || !fromUser) {
    await ctx.reply("Chat tidak valid.");
    return;
  }

  const customer = await getOrCreateTelegramCustomer(
    botConfig.userId,
    botConfig.id,
    chatId,
    fromUser.first_name ?? null,
  );

  const [customerStats, botStats] = await Promise.all([
    getCustomerStats(customer.id),
    getBotStats(botConfig.userId, botConfig.id),
  ]);

  const welcomeText = renderWelcome({
    botName: botConfig.name,
    customWelcome: botConfig.welcomeMsg,
    user: {
      id: fromUser.id,
      username: fromUser.username ?? null,
      firstName: fromUser.first_name ?? null,
    },
    customerStats,
    botStats,
  });

  if (botConfig.startBanner) {
    try {
      await ctx.replyWithPhoto(botConfig.startBanner, {
        caption:
          welcomeText.length > 1000 ? welcomeText.slice(0, 1000) : welcomeText,
        parse_mode: "HTML",
      });
      // If the caption was clipped, send the rest as a follow-up text.
      if (welcomeText.length > 1000) {
        await ctx.reply(welcomeText.slice(1000), { parse_mode: "HTML" });
      }
    } catch (err) {
      console.warn("[telegram] banner send failed, falling back:", err);
      await ctx.reply(welcomeText, { parse_mode: "HTML" });
    }
  } else {
    await ctx.reply(welcomeText, { parse_mode: "HTML" });
  }

  const list = await renderProductList(botConfig.userId, 1);
  await ctx.reply(list.text, {
    parse_mode: "HTML",
    reply_markup: list.kb,
  });
}

export async function startTelegramBot(botId: string) {
  const botConfig = await prisma.bot.findUnique({
    where: { id: botId },
    include: { user: true },
  });

  if (!botConfig || !botConfig.token || botConfig.type !== "telegram") {
    throw new Error("Invalid bot configuration");
  }

  if (activeBots.has(botId)) {
    await stopTelegramBot(botId);
  }

  const bot = new GrammyBot(botConfig.token);
  const cfg: BotConfig = {
    id: botConfig.id,
    userId: botConfig.userId,
    name: botConfig.name,
    token: botConfig.token,
    type: botConfig.type,
    isAutoOrder: botConfig.isAutoOrder,
    contactPerson: botConfig.contactPerson,
    welcomeMsg: botConfig.welcomeMsg,
    startBanner: botConfig.startBanner,
    qrisServerId: botConfig.qrisServerId,
  };

  bot.command("start", async (ctx) => {
    await sendStart(ctx, cfg);
  });

  bot.command(["stock", "menu"], async (ctx) => {
    const list = await renderProductList(cfg.userId, 1);
    await ctx.reply(list.text, {
      parse_mode: "HTML",
      reply_markup: list.kb,
    });
  });

  bot.command("topproduk", async (ctx) => {
    const view = await renderTopProducts(cfg.userId);
    await ctx.reply(view.text, {
      parse_mode: "HTML",
      reply_markup: view.kb,
    });
  });

  bot.command("saldo", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (!chatId) {
      await ctx.reply("Chat tidak valid.");
      return;
    }
    const customer = await getOrCreateTelegramCustomer(
      cfg.userId,
      cfg.id,
      chatId,
      ctx.from?.first_name ?? null,
    );
    const fresh = await prisma.customer.findUnique({
      where: { id: customer.id },
      select: { balance: true },
    });
    await ctx.reply(
      `💰 Saldo Anda: ${rupiah(fresh?.balance ?? 0)}\n\nIsi saldo: /topup NOMINAL`,
    );
  });

  bot.command("topup", async (ctx) => {
    if (!cfg.qrisServerId) {
      await ctx.reply("QRIS belum diatur untuk bot ini. Hubungi admin.");
      return;
    }
    const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
    const amount = parseInt((args[0] || "").replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(amount) || amount < 1000 || amount > 10_000_000) {
      await ctx.reply(
        "Format: /topup NOMINAL\nMinimal Rp 1.000, maksimal Rp 10.000.000",
      );
      return;
    }
    const server = await prisma.qrisServer.findUnique({
      where: { id: cfg.qrisServerId },
    });
    if (!server || !server.isActive) {
      await ctx.reply("QRIS tidak aktif.");
      return;
    }
    const chatId = String(ctx.chat?.id ?? "");
    if (!chatId) {
      await ctx.reply("Chat tidak valid.");
      return;
    }
    const customer = await getOrCreateTelegramCustomer(
      cfg.userId,
      cfg.id,
      chatId,
      ctx.from?.first_name ?? null,
    );
    const orderId = generateOrderId("TP");
    const created = await createQris(server, { amount, orderId });
    if (!created.ok) {
      await ctx.reply(`❌ Gagal generate QRIS: ${created.error}`);
      return;
    }
    await prisma.payment.create({
      data: {
        ownerUserId: cfg.userId,
        customerId: customer.id,
        botId: cfg.id,
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
      "🧾 QRIS Topup Saldo",
      "",
      `Nominal: ${rupiah(amount)}`,
      `Total: ${rupiah(created.totalAmount)}`,
      `Order ID: ${orderId}`,
      "",
    ];
    if (created.paymentUrl) lines.push(`Bayar di: ${created.paymentUrl}`);
    if (created.qrString) lines.push(`QR String:\n${created.qrString}`);
    if (created.expiresAt) {
      lines.push(
        "",
        `⏰ Expired: ${created.expiresAt.toLocaleString("id-ID")}`,
      );
    }
    lines.push("", "Saldo akan otomatis bertambah setelah bayar.");
    await ctx.reply(lines.join("\n"));
  });

  // Slash-style /buy and /buynow remain for power users; the inline buttons
  // map onto the same handlers via `executeBuyWithBalance` / `executeBuyNow`.
  bot.command("buy", async (ctx) => {
    if (!cfg.isAutoOrder) {
      await ctx.reply("Auto order tidak aktif. Hubungi admin.");
      return;
    }
    const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
    if (args.length < 1) {
      await ctx.reply("Format: /buy KODE [QTY]\nContoh: /buy NETFLIX1 1");
      return;
    }
    const code = args[0]!;
    const qty = parseInt(args[1] || "1");
    const chatId = String(ctx.chat?.id ?? "");
    if (!chatId) {
      await ctx.reply("Chat tidak valid.");
      return;
    }
    const variation = await prisma.productVariation.findFirst({
      where: {
        code,
        isActive: true,
        product: { userId: cfg.userId, isActive: true },
      },
      select: { id: true },
    });
    if (!variation) {
      await ctx.reply("Produk tidak ditemukan.");
      return;
    }
    const reply = await executeBuyWithBalance(
      cfg.userId,
      cfg.id,
      chatId,
      ctx.from?.first_name ?? null,
      variation.id,
      qty,
    );
    await ctx.reply(reply);
  });

  bot.command("buynow", async (ctx) => {
    if (!cfg.isAutoOrder) {
      await ctx.reply("Auto order tidak aktif. Hubungi admin.");
      return;
    }
    const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
    if (args.length < 1) {
      await ctx.reply("Format: /buynow KODE [QTY]");
      return;
    }
    const code = args[0]!;
    const qty = parseInt(args[1] || "1");
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100) {
      await ctx.reply("Jumlah tidak valid (1-100)");
      return;
    }
    const chatId = String(ctx.chat?.id ?? "");
    if (!chatId) {
      await ctx.reply("Chat tidak valid.");
      return;
    }
    const variation = await prisma.productVariation.findFirst({
      where: {
        code,
        isActive: true,
        product: { userId: cfg.userId, isActive: true },
      },
      select: { id: true },
    });
    if (!variation) {
      await ctx.reply("Produk tidak ditemukan.");
      return;
    }
    const reply = await executeBuyNow(
      cfg.userId,
      cfg.id,
      cfg.qrisServerId,
      chatId,
      ctx.from?.first_name ?? null,
      variation.id,
      qty,
    );
    await ctx.reply(reply);
  });

  bot.command("help", async (ctx) => {
    const contact = cfg.contactPerson
      ? `\n\n📞 Contact: ${cfg.contactPerson}`
      : "";
    await ctx.reply(
      "📌 Perintah Bot:\n\n" +
        "/start - Mulai\n" +
        "/stock - Lihat produk\n" +
        "/topproduk - Produk populer\n" +
        "/saldo - Cek saldo\n" +
        "/topup NOMINAL - Isi saldo via QRIS\n" +
        "/buy KODE [QTY] - Beli pakai saldo\n" +
        "/buynow KODE [QTY] - Beli langsung pakai QRIS\n" +
        "/help - Bantuan" +
        contact,
    );
  });

  // Inline-keyboard navigation & buy actions.
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    try {
      if (data === "noop") {
        await ctx.answerCallbackQuery();
        return;
      }
      if (data.startsWith("n:l:")) {
        const page = parseInt(data.slice(4), 10) || 1;
        const list = await renderProductList(cfg.userId, page);
        await ctx.editMessageText(list.text, {
          parse_mode: "HTML",
          reply_markup: list.kb,
        });
        await ctx.answerCallbackQuery();
        return;
      }
      if (data.startsWith("n:p:")) {
        const productId = data.slice(4);
        const view = await renderProductDetail(cfg.userId, productId);
        if (!view) {
          await ctx.answerCallbackQuery({ text: "Produk tidak ditemukan" });
          return;
        }
        await ctx.editMessageText(view.text, {
          parse_mode: "HTML",
          reply_markup: view.kb,
        });
        await ctx.answerCallbackQuery();
        return;
      }
      if (data.startsWith("n:v:")) {
        const variationId = data.slice(4);
        const view = await renderVariationDetail(cfg.userId, variationId, 1);
        if (!view) {
          await ctx.answerCallbackQuery({ text: "Variasi tidak ditemukan" });
          return;
        }
        await ctx.editMessageText(view.text, {
          parse_mode: "HTML",
          reply_markup: view.kb,
        });
        await ctx.answerCallbackQuery();
        return;
      }
      if (data.startsWith("q:")) {
        const [, variationId, qtyRaw] = data.split(":");
        if (!variationId) {
          await ctx.answerCallbackQuery();
          return;
        }
        const qty = Math.max(
          1,
          Math.min(parseInt(qtyRaw || "1", 10) || 1, 100),
        );
        const view = await renderVariationDetail(cfg.userId, variationId, qty);
        if (!view) {
          await ctx.answerCallbackQuery({ text: "Variasi tidak ditemukan" });
          return;
        }
        await ctx.editMessageText(view.text, {
          parse_mode: "HTML",
          reply_markup: view.kb,
        });
        await ctx.answerCallbackQuery();
        return;
      }
      if (data === "act:saldo") {
        const chatId = String(ctx.chat?.id ?? "");
        if (!chatId) {
          await ctx.answerCallbackQuery();
          return;
        }
        const customer = await getOrCreateTelegramCustomer(
          cfg.userId,
          cfg.id,
          chatId,
          ctx.from?.first_name ?? null,
        );
        const fresh = await prisma.customer.findUnique({
          where: { id: customer.id },
          select: { balance: true },
        });
        await ctx.answerCallbackQuery({
          text: `💰 Saldo: ${rupiah(fresh?.balance ?? 0)}`,
          show_alert: true,
        });
        return;
      }
      if (data === "act:top") {
        const view = await renderTopProducts(cfg.userId);
        await ctx.editMessageText(view.text, {
          parse_mode: "HTML",
          reply_markup: view.kb,
        });
        await ctx.answerCallbackQuery();
        return;
      }
      if (data.startsWith("b:") || data.startsWith("bn:")) {
        if (!cfg.isAutoOrder) {
          await ctx.answerCallbackQuery({
            text: "Auto order tidak aktif",
            show_alert: true,
          });
          return;
        }
        const isBuyNow = data.startsWith("bn:");
        const parts = data.split(":");
        const variationId = parts[1];
        const qty = Math.max(
          1,
          Math.min(parseInt(parts[2] || "1", 10) || 1, 100),
        );
        const chatId = String(ctx.chat?.id ?? "");
        if (!variationId || !chatId) {
          await ctx.answerCallbackQuery();
          return;
        }
        await ctx.answerCallbackQuery({ text: "Memproses…" });
        const reply = isBuyNow
          ? await executeBuyNow(
              cfg.userId,
              cfg.id,
              cfg.qrisServerId,
              chatId,
              ctx.from?.first_name ?? null,
              variationId,
              qty,
            )
          : await executeBuyWithBalance(
              cfg.userId,
              cfg.id,
              chatId,
              ctx.from?.first_name ?? null,
              variationId,
              qty,
            );
        await ctx.reply(reply);
        return;
      }
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error(`[telegram ${botId}] callback error:`, err);
      try {
        await ctx.answerCallbackQuery({ text: "Terjadi kesalahan" });
      } catch {
        // ignore
      }
    }
  });

  bot.catch((err) => {
    if (err instanceof GrammyError) {
      console.error(`Bot ${botId} grammy error:`, err.description);
    } else if (err instanceof HttpError) {
      console.error(`Bot ${botId} network error:`, err.message);
    } else {
      console.error(`Bot ${botId} error:`, err);
    }
  });

  bot.start().catch((err) => {
    console.error(`Bot ${botId} start error:`, err);
  });
  activeBots.set(botId, bot);

  await prisma.bot.update({
    where: { id: botId },
    data: { isConnected: true, status: "active" },
  });

  return true;
}

export async function stopTelegramBot(botId: string) {
  const bot = activeBots.get(botId);
  if (bot) {
    await bot.stop().catch(() => {});
    activeBots.delete(botId);
  }
  await prisma.bot.update({
    where: { id: botId },
    data: { isConnected: false, status: "inactive" },
  });
}

export async function sendTelegramBroadcast(
  botId: string,
  message: string,
  targets: string[],
) {
  const bot = activeBots.get(botId);
  if (!bot) throw new Error("Bot belum aktif. Start bot terlebih dahulu.");

  const results = [];
  for (const target of targets) {
    try {
      // Use plain text (no parse_mode) so user-supplied formatting characters
      // don't break message delivery.
      await bot.api.sendMessage(target, message);
      results.push({ target, success: true });
    } catch (err) {
      results.push({ target, success: false, error: String(err) });
    }
  }
  return results;
}

/**
 * Push a plain-text message to a Telegram chat from a bot context. Used by
 * the payment webhook handler to notify the customer once their QRIS has
 * been settled. Returns false if the bot is not currently running.
 */
export async function notifyTelegramChat(
  botId: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  const bot = activeBots.get(botId);
  if (!bot) return false;
  try {
    await bot.api.sendMessage(chatId, text);
    return true;
  } catch (err) {
    console.error("[telegram] notifyTelegramChat failed:", err);
    return false;
  }
}

export function isBotActive(botId: string): boolean {
  return activeBots.has(botId);
}
