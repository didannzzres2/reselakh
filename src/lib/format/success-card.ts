/**
 * Shared formatter for the "TRANSAKSI SUKSES" card sent over Telegram and
 * WhatsApp after a successful /buy (saldo) or /buynow (QRIS) order. The card
 * is plain UTF-8 art so it renders consistently in both chats.
 */

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

/** "7 Mei 2026 pukul 16.44 WIB" — Asia/Jakarta. */
export function formatTransactionDate(d: Date = new Date()): string {
  // Convert to Asia/Jakarta (UTC+7) regardless of server TZ.
  const jakarta = new Date(d.getTime() + 7 * 3600_000);
  const day = jakarta.getUTCDate();
  const month = MONTH_NAMES_ID[jakarta.getUTCMonth()] ?? "";
  const year = jakarta.getUTCFullYear();
  const hh = pad2(jakarta.getUTCHours());
  const mm = pad2(jakarta.getUTCMinutes());
  return `${day} ${month} ${year} pukul ${hh}.${mm} WIB`;
}

export function rupiah(n: number): string {
  return Math.round(n).toLocaleString("id-ID");
}

export interface SuccessCardData {
  invoiceId: string;
  buyerNumber: number | string;
  telegramId?: string | number | null;
  /** Telegram @username (with or without leading @) — leave blank when unknown. */
  telegramUsername?: string | null;
  productName: string;
  variationName: string;
  quantity: number;
  amount: number;
  fee: number;
  total: number;
  method: "Saldo" | "QRIS";
  date?: Date;
  /** Raw `email|password|info` lines (one per delivered account). */
  accountData: string;
}

/** Parse a single Stock.data row "email|password|info". Tolerates fewer fields. */
function parseAccountLine(raw: string): {
  email: string | null;
  password: string | null;
  info: string | null;
} {
  const parts = raw.split("|").map((s) => s.trim());
  return {
    email: parts[0] || null,
    password: parts[1] || null,
    info: parts.slice(2).join(" | ") || null,
  };
}

/**
 * Render the full TRANSAKSI SUKSES card. Returns plain text — Telegram should
 * send with `parse_mode: undefined` (not HTML) since the box-drawing chars are
 * already pretty enough; WhatsApp accepts the same string verbatim.
 */
export function formatSuccessCard(data: SuccessCardData): string {
  const lines: string[] = [];
  lines.push("╭────〔 TRANSAKSI SUKSES 〕───────");
  lines.push(`┊・Invoice ID : ${data.invoiceId}`);
  lines.push(`┊・Nama Produk : ${data.productName}`);
  lines.push(`┊・Nama Variasi : ${data.variationName}`);
  lines.push(`┊・ID Buyer : ${data.buyerNumber}`);
  lines.push(`┊・ID Tele Buyer : ${data.telegramId ?? "-"}`);
  const username = data.telegramUsername
    ? data.telegramUsername.startsWith("@")
      ? data.telegramUsername
      : `@${data.telegramUsername}`
    : "";
  lines.push(`┊・Username Telegram: ${username}`.trimEnd());
  lines.push(`┊・Jumlah Beli : ${data.quantity}`);
  lines.push(`┊・Jumlah Akun didapat : ${data.quantity}`);
  lines.push(`┊・Harga : ${rupiah(data.amount)}`);
  lines.push(`┊・Fee : ${rupiah(data.fee)}`);
  lines.push(`┊・Total Dibayar : ${rupiah(data.total)}`);
  lines.push(`┊・Methode Pay : ${data.method}`);
  lines.push(
    `┊・Tanggal/Jam Transaksi : ${formatTransactionDate(data.date ?? new Date())}`,
  );
  lines.push("╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈");
  lines.push("");
  lines.push("");
  lines.push("Akun premium kamu:");
  lines.push("");

  const rows = data.accountData
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (rows.length === 0) {
    lines.push("(data akun kosong, hubungi admin)");
  } else {
    rows.forEach((row, idx) => {
      const acc = parseAccountLine(row);
      lines.push(`${idx + 1}. ${data.productName} — ${data.variationName}`);
      if (acc.email) lines.push(`📧 Email: ${acc.email}`);
      if (acc.password) lines.push(`🔑 Password: ${acc.password}`);
      if (acc.info) lines.push(`ℹ Info: ${acc.info}`);
      lines.push("");
    });
  }
  return lines.join("\n").trimEnd();
}

/**
 * Generate a human-readable invoice id like "AKH-20260507-QQQM8D" — uses the
 * supplied prefix (defaults to "INV"), today's date, and 6 uppercase chars
 * from the order/payment id.
 */
export function buildInvoiceId(
  reference: string,
  prefix = "INV",
  d: Date = new Date(),
): string {
  const jakarta = new Date(d.getTime() + 7 * 3600_000);
  const ymd = `${jakarta.getUTCFullYear()}${pad2(jakarta.getUTCMonth() + 1)}${pad2(jakarta.getUTCDate())}`;
  const tail = reference.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase();
  return `${prefix.toUpperCase()}-${ymd}-${tail || "XXXXXX"}`;
}
