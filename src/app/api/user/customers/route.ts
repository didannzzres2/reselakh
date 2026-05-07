import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, requireAuth, ValidationError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { idSchema, parseJson, clampInt } from "@/lib/validate";

const CreateSchema = z.object({
  botId: idSchema,
  jid: z.string().trim().max(120).optional().nullable(),
  chatId: z.string().trim().max(120).optional().nullable(),
  name: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(160).optional().nullable(),
  initialBalance: z.number().int().min(0).max(1_000_000_000).optional(),
});

const UpdateSchema = z.object({
  id: idSchema,
  name: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(160).optional().nullable(),
  status: z.enum(["active", "blocked"]).optional(),
  balanceAdjustment: z.number().int().optional(),
  adjustmentNote: z.string().trim().max(200).optional(),
});

const DeleteSchema = z.object({ id: idSchema });

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    const url = new URL(request.url);
    const page = clampInt(url.searchParams.get("page"), 1, 1, 10_000);
    const pageSize = clampInt(url.searchParams.get("pageSize"), 20, 1, 100);
    const search = (url.searchParams.get("q") || "").trim();
    const botId = url.searchParams.get("botId") || undefined;

    const where = {
      ownerUserId: session.id,
      ...(botId ? { botId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { jid: { contains: search, mode: "insensitive" as const } },
              { chatId: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          bot: { select: { id: true, name: true, type: true } },
        },
      }),
      prisma.customer.count({ where }),
    ]);

    return NextResponse.json({ items, total, page, pageSize });
  } catch (err) {
    return handleApiError("user/customers:GET", err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const data = await parseJson(request, CreateSchema);
    if (!data.jid && !data.chatId) {
      throw new ValidationError("JID atau chatId wajib diisi");
    }
    const bot = await prisma.bot.findFirst({
      where: { id: data.botId, userId: session.id },
      select: { id: true },
    });
    if (!bot) throw new ValidationError("Bot tidak ditemukan");

    const customer = await prisma.customer.create({
      data: {
        ownerUserId: session.id,
        botId: data.botId,
        jid: data.jid || null,
        chatId: data.chatId || null,
        name: data.name || null,
        phone: data.phone || null,
        email: data.email || null,
        balance: data.initialBalance ?? 0,
      },
    });
    if (data.initialBalance && data.initialBalance > 0) {
      await prisma.customerMutation.create({
        data: {
          customerId: customer.id,
          type: "credit",
          amount: data.initialBalance,
          balBefore: 0,
          balAfter: data.initialBalance,
          description: "Initial balance",
          source: "manual",
        },
      });
    }
    return NextResponse.json({ success: true, customer });
  } catch (err) {
    return handleApiError("user/customers:POST", err);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAuth();
    const data = await parseJson(request, UpdateSchema);

    const owned = await prisma.customer.findFirst({
      where: { id: data.id, ownerUserId: session.id },
      select: { id: true, balance: true },
    });
    if (!owned) throw new ValidationError("Customer tidak ditemukan");

    const updated = await prisma.$transaction(async (tx) => {
      const updates: {
        name?: string | null;
        phone?: string | null;
        email?: string | null;
        status?: string;
      } = {};
      if (data.name !== undefined) updates.name = data.name || null;
      if (data.phone !== undefined) updates.phone = data.phone || null;
      if (data.email !== undefined) updates.email = data.email || null;
      if (data.status !== undefined) updates.status = data.status;

      const adj = data.balanceAdjustment ?? 0;
      if (adj !== 0) {
        const newBal = owned.balance + adj;
        if (newBal < 0) {
          throw new ValidationError("Saldo tidak boleh negatif");
        }
        await tx.customer.update({
          where: { id: data.id },
          data: { balance: newBal, ...updates },
        });
        await tx.customerMutation.create({
          data: {
            customerId: data.id,
            type: adj > 0 ? "credit" : "debit",
            amount: Math.abs(adj),
            balBefore: owned.balance,
            balAfter: newBal,
            description: data.adjustmentNote || "Manual adjustment",
            source: "manual",
          },
        });
      } else if (Object.keys(updates).length > 0) {
        await tx.customer.update({ where: { id: data.id }, data: updates });
      }
      return tx.customer.findUnique({ where: { id: data.id } });
    });

    return NextResponse.json({ success: true, customer: updated });
  } catch (err) {
    return handleApiError("user/customers:PATCH", err);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireAuth();
    const { id } = await parseJson(request, DeleteSchema);
    const owned = await prisma.customer.findFirst({
      where: { id, ownerUserId: session.id },
      select: { id: true },
    });
    if (!owned) throw new ValidationError("Customer tidak ditemukan");
    await prisma.customer.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError("user/customers:DELETE", err);
  }
}
