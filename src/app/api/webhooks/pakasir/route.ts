import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { settlePaidPayment } from "@/lib/order";
import { notifyCustomerByJid } from "@/lib/whatsapp";
import { notifyTelegramChat } from "@/lib/telegram";
import {
  buildInvoiceId,
  formatSuccessCard,
} from "@/lib/format/success-card";

/**
 * Pakasir callback webhook. According to https://pakasir.com/p/docs Pakasir
 * POSTs `{ project, amount, order_id, status, payment_method, completed_at,
 * api_key }` to the configured callback URL when a transaction completes. We
 * authenticate by matching `api_key` against the QrisServer.apiKey we used to
 * create the QR.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const orderId = String(body.order_id || body.orderId || "");
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "missing order_id" }, { status: 400 });
    }
    const status = String(body.status || "").toLowerCase();
    const apiKey = String(body.api_key || "");

    const payment = await prisma.payment.findUnique({
      where: { orderId },
      include: { qrisServer: true, customer: true },
    });
    if (!payment) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    if (payment.provider !== "pakasir") {
      return NextResponse.json({ ok: false, error: "wrong provider" }, { status: 400 });
    }

    if (payment.qrisServer?.apiKey && apiKey !== payment.qrisServer.apiKey) {
      return NextResponse.json({ ok: false, error: "bad api_key" }, { status: 401 });
    }

    if (status !== "completed" && status !== "paid" && status !== "success") {
      return NextResponse.json({ ok: true, handled: false, status });
    }

    const result = await settlePaidPayment(payment.id);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    if (result.kind !== "noop" && payment.botId && payment.customer) {
      const bot = await prisma.bot.findUnique({
        where: { id: payment.botId },
        select: { type: true },
      });
      let message = "";
      if (result.kind === "topup") {
        message = `✅ Topup berhasil. Saldo Anda sekarang: Rp ${result.balanceAfter.toLocaleString("id-ID")}`;
      } else if (result.kind === "buynow") {
        const buyerNumber = await prisma.customer.count({
          where: {
            ownerUserId: payment.ownerUserId,
            createdAt: { lte: payment.customer.createdAt },
          },
        });
        message = formatSuccessCard({
          invoiceId: buildInvoiceId(payment.orderId, "AKH"),
          buyerNumber,
          telegramId: payment.customer.chatId ?? null,
          telegramUsername:
            bot?.type === "telegram" ? payment.customer.name : null,
          productName: result.productName,
          variationName: result.variationName,
          quantity: payment.qty ?? 1,
          amount: payment.amount,
          fee: payment.fee,
          total: payment.totalAmount,
          method: "QRIS",
          accountData: result.accountData,
        });
      }
      if (message && bot) {
        if (bot.type === "whatsapp" && payment.customer.jid) {
          await notifyCustomerByJid(payment.botId, payment.customer.jid, message);
        } else if (bot.type === "telegram" && payment.customer.chatId) {
          await notifyTelegramChat(payment.botId, payment.customer.chatId, message);
        }
      }
    }

    return NextResponse.json({ ok: true, kind: result.kind });
  } catch (err) {
    console.error("[webhooks/pakasir] error:", err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
