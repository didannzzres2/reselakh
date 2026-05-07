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
 * EQRIS callback webhook. EQRIS posts a JSON body when a QRIS payment moves
 * to "paid". The exact field names vary across EQRIS deployments — we look up
 * by `orderId` (a.k.a. reference / merchant_ref / external_id) and ignore
 * everything else. Caller must include the orderId we generated in
 * `payments.eqris.ts`.
 *
 * EQRIS callback secrets are stored on the `QrisServer.apiSecret` column.
 * If set, we validate `x-callback-token` (or `signature`) against it.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const orderId =
      (body.orderId as string) ||
      (body.order_id as string) ||
      (body.reference as string) ||
      (body.merchant_ref as string) ||
      (body.external_id as string) ||
      "";
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "missing orderId" }, { status: 400 });
    }
    const status = String(
      body.status || body.transaction_status || "",
    ).toLowerCase();
    const isPaid = ["paid", "success", "settlement", "completed"].includes(
      status,
    );

    const payment = await prisma.payment.findUnique({
      where: { orderId },
      include: { qrisServer: true, customer: true },
    });
    if (!payment) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    if (payment.provider !== "eqris") {
      return NextResponse.json(
        { ok: false, error: "wrong provider" },
        { status: 400 },
      );
    }

    const expected = payment.qrisServer?.apiSecret;
    if (expected) {
      const headerToken =
        request.headers.get("x-callback-token") ||
        request.headers.get("signature") ||
        "";
      if (headerToken !== expected) {
        return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
      }
    }

    if (!isPaid) {
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
    console.error("[webhooks/eqris] error:", err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
