import { NextResponse } from "next/server";
import { handleApiError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clampInt } from "@/lib/validate";

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    const url = new URL(request.url);
    const page = clampInt(url.searchParams.get("page"), 1, 1, 10_000);
    const pageSize = clampInt(url.searchParams.get("pageSize"), 20, 1, 100);
    const status = url.searchParams.get("status") || undefined;
    const purpose = url.searchParams.get("purpose") || undefined;
    const provider = url.searchParams.get("provider") || undefined;
    const botId = url.searchParams.get("botId") || undefined;

    const where = {
      ownerUserId: session.id,
      ...(status ? { status } : {}),
      ...(purpose ? { purpose } : {}),
      ...(provider ? { provider } : {}),
      ...(botId ? { botId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: {
            select: { id: true, jid: true, chatId: true, name: true },
          },
          bot: { select: { id: true, name: true, type: true } },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    return NextResponse.json({ items, total, page, pageSize });
  } catch (err) {
    return handleApiError("user/payments:GET", err);
  }
}
