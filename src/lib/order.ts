import { prisma } from "./prisma";

export interface OrderResult {
  ok: true;
  subtotal: number;
  discount: number;
  totalPrice: number;
  accountData: string;
  productName: string;
  variationName: string;
  voucherCode?: string;
  orderId: string;
}

export interface OrderError {
  ok: false;
  error: string;
}

/**
 * Atomically claim `qty` available stocks for the given variation code, apply
 * an optional voucher discount, and create the order record. Returns the
 * resulting account data on success.
 *
 * Stock claim, voucher claim, and order create all happen in a single
 * transaction so concurrent buyers cannot oversell and a voucher cannot be
 * claimed past `maxUses`. When `paymentMode === "balance"`, the customer's
 * balance is also debited atomically inside the same transaction.
 */
export async function placeBotOrder(params: {
  ownerUserId: string;
  code: string;
  qty: number;
  source: "telegram" | "whatsapp";
  voucherCode?: string;
  customerId?: string;
  paymentMode?: "balance" | "external" | "free";
}): Promise<OrderResult | OrderError> {
  const {
    ownerUserId,
    code,
    qty,
    source,
    voucherCode,
    customerId,
    paymentMode = "external",
  } = params;

  if (!Number.isFinite(qty) || qty <= 0 || qty > 100) {
    return { ok: false, error: "Jumlah tidak valid (1-100)" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const variation = await tx.productVariation.findFirst({
        where: {
          code,
          isActive: true,
          product: { userId: ownerUserId, isActive: true },
        },
        include: { product: true },
      });

      if (!variation) {
        return { ok: false, error: "Produk tidak ditemukan" } as OrderError;
      }

      const candidateStocks = await tx.stock.findMany({
        where: { variationId: variation.id, isSold: false },
        take: qty,
        select: { id: true, data: true },
      });

      if (candidateStocks.length < qty) {
        return {
          ok: false,
          error: `Stock tidak cukup. Tersedia: ${candidateStocks.length}`,
        } as OrderError;
      }

      const ids = candidateStocks.map((s) => s.id);

      // Atomic claim — only updates rows that are still available.
      const claimed = await tx.stock.updateMany({
        where: { id: { in: ids }, isSold: false },
        data: { isSold: true, soldAt: new Date() },
      });

      if (claimed.count < qty) {
        // Someone else got there first; rollback.
        throw new Error("Stock terjual oleh transaksi lain, coba lagi");
      }

      const subtotal = variation.price * qty;

      // Optional voucher application — capped at subtotal so we never go
      // negative.
      let discount = 0;
      let appliedVoucherId: string | null = null;
      const trimmedVoucherCode = voucherCode?.trim();
      if (trimmedVoucherCode) {
        const voucher = await tx.voucher.findUnique({
          where: { code: trimmedVoucherCode.toUpperCase() },
        });
        if (!voucher || !voucher.isActive) {
          throw new Error("Voucher tidak ditemukan / nonaktif");
        }
        if (voucher.expiresAt && voucher.expiresAt.getTime() < Date.now()) {
          throw new Error("Voucher kadaluarsa");
        }
        if (voucher.minPurchase != null && subtotal < voucher.minPurchase) {
          throw new Error(
            `Minimal pembelian untuk voucher ini Rp ${voucher.minPurchase.toLocaleString("id-ID")}`,
          );
        }
        if (voucher.usedCount >= voucher.maxUses) {
          throw new Error("Voucher sudah habis");
        }

        const rawDiscount =
          voucher.type === "percentage"
            ? Math.floor((subtotal * voucher.amount) / 100)
            : Math.floor(voucher.amount);
        discount = Math.min(Math.max(0, rawDiscount), subtotal);
        appliedVoucherId = voucher.id;

        // Atomic claim — only succeeds if voucher still has room.
        const voucherClaimed = await tx.voucher.updateMany({
          where: {
            id: voucher.id,
            isActive: true,
            usedCount: { lt: voucher.maxUses },
          },
          data: { usedCount: { increment: 1 } },
        });
        if (voucherClaimed.count === 0) {
          throw new Error("Voucher sudah habis");
        }
      }

      const totalPrice = Math.max(0, subtotal - discount);
      const accountData = candidateStocks.map((s) => s.data).join("\n");

      // /buy mode: debit customer balance atomically before creating order.
      if (paymentMode === "balance") {
        if (!customerId) {
          throw new Error("Customer tidak ditemukan");
        }
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
          select: { id: true, balance: true, status: true, ownerUserId: true },
        });
        if (!customer || customer.ownerUserId !== ownerUserId) {
          throw new Error("Customer tidak valid");
        }
        if (customer.status !== "active") {
          throw new Error("Customer non-aktif / banned");
        }
        if (customer.balance < totalPrice) {
          throw new Error(
            `Saldo tidak cukup. Saldo Anda Rp ${customer.balance.toLocaleString("id-ID")}, butuh Rp ${totalPrice.toLocaleString("id-ID")}`,
          );
        }

        const debit = await tx.customer.updateMany({
          where: { id: customerId, balance: { gte: totalPrice } },
          data: { balance: { decrement: totalPrice } },
        });
        if (debit.count === 0) {
          throw new Error("Saldo customer tidak cukup");
        }

        await tx.customerMutation.create({
          data: {
            customerId,
            type: "debit",
            amount: totalPrice,
            balBefore: customer.balance,
            balAfter: customer.balance - totalPrice,
            description: `Pembelian ${variation.product.name} ${variation.name} x${qty}`,
            source: "purchase",
          },
        });
      }

      const order = await tx.order.create({
        data: {
          userId: ownerUserId,
          productId: variation.product.id,
          variationId: variation.id,
          quantity: qty,
          totalPrice,
          status: "completed",
          accountData,
          source,
        },
      });

      if (customerId) {
        await tx.customerOrder.create({
          data: { customerId, orderId: order.id },
        });
      }

      if (appliedVoucherId) {
        await tx.voucherUsage.create({
          data: {
            voucherId: appliedVoucherId,
            userId: ownerUserId,
            amount: discount,
          },
        });
      }

      return {
        ok: true,
        subtotal,
        discount,
        totalPrice,
        accountData,
        productName: variation.product.name,
        variationName: variation.name,
        voucherCode: trimmedVoucherCode || undefined,
        orderId: order.id,
      } as OrderResult;
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Order gagal",
    };
  }
}

export type SettleResult =
  | {
      ok: true;
      kind: "buynow";
      orderId: string;
      accountData: string;
      productName: string;
      variationName: string;
    }
  | { ok: true; kind: "topup"; balanceAfter: number; customerId: string }
  | { ok: true; kind: "noop" }
  | { ok: false; error: string };

/**
 * Settle a previously-pending Payment row that the gateway has now reported
 * as paid. Idempotent on `payment.status` — calling on a non-pending Payment
 * is a no-op. For /buynow payments, claims stock & emits an Order; for /topup
 * payments, credits the customer balance. All side-effects happen inside a
 * single Postgres transaction so partial failures roll back cleanly.
 */
export async function settlePaidPayment(paymentId: string): Promise<SettleResult> {
  try {
    const result = await prisma.$transaction<SettleResult>(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) return { ok: false, error: "Payment tidak ditemukan" };
      if (payment.status === "completed") return { ok: true, kind: "noop" };
      if (payment.status !== "pending") {
        return { ok: false, error: `Payment status ${payment.status}` };
      }

      const updated = await tx.payment.updateMany({
        where: { id: paymentId, status: "pending" },
        data: { status: "completed", paidAt: new Date() },
      });
      if (updated.count === 0) return { ok: true, kind: "noop" };

      if (payment.purpose === "topup" && payment.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: payment.customerId },
          select: { id: true, balance: true },
        });
        if (!customer) return { ok: false, error: "Customer tidak ditemukan" };
        await tx.customer.update({
          where: { id: customer.id },
          data: { balance: { increment: payment.amount } },
        });
        await tx.customerMutation.create({
          data: {
            customerId: customer.id,
            type: "credit",
            amount: payment.amount,
            balBefore: customer.balance,
            balAfter: customer.balance + payment.amount,
            description: `Topup QRIS ${payment.provider.toUpperCase()}`,
            source: "topup",
            reference: payment.id,
          },
        });
        return {
          ok: true,
          kind: "topup",
          balanceAfter: customer.balance + payment.amount,
          customerId: customer.id,
        };
      }

      if (payment.purpose === "buynow" && payment.productCode && payment.qty) {
        const variation = await tx.productVariation.findFirst({
          where: {
            code: payment.productCode,
            isActive: true,
            product: { userId: payment.ownerUserId, isActive: true },
          },
          include: { product: true },
        });
        if (!variation) {
          return { ok: false, error: "Produk tidak ditemukan saat fulfil" };
        }

        const candidateStocks = await tx.stock.findMany({
          where: { variationId: variation.id, isSold: false },
          take: payment.qty,
          select: { id: true, data: true },
        });
        if (candidateStocks.length < payment.qty) {
          return {
            ok: false,
            error: `Stock tidak cukup saat fulfil. Tersedia: ${candidateStocks.length}`,
          };
        }
        const ids = candidateStocks.map((s) => s.id);
        const claimed = await tx.stock.updateMany({
          where: { id: { in: ids }, isSold: false },
          data: { isSold: true, soldAt: new Date() },
        });
        if (claimed.count < payment.qty) {
          return { ok: false, error: "Stock terjual oleh transaksi lain" };
        }
        const accountData = candidateStocks.map((s) => s.data).join("\n");
        const order = await tx.order.create({
          data: {
            userId: payment.ownerUserId,
            productId: variation.product.id,
            variationId: variation.id,
            quantity: payment.qty,
            totalPrice: payment.amount,
            status: "completed",
            accountData,
            source: "whatsapp",
          },
        });
        if (payment.customerId) {
          await tx.customerOrder.create({
            data: { customerId: payment.customerId, orderId: order.id },
          });
        }
        return {
          ok: true,
          kind: "buynow",
          orderId: order.id,
          accountData,
          productName: variation.product.name,
          variationName: variation.name,
        };
      }

      return { ok: true, kind: "noop" };
    });
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Settle gagal",
    };
  }
}
