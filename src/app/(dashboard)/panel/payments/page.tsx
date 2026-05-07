"use client";

import { useEffect, useState, useCallback } from "react";
import Spinner from "@/components/loading/Spinner";
import { formatCurrency, formatDate } from "@/lib/utils";

interface PaymentData {
  id: string;
  orderId: string;
  amount: number;
  status: string;
  purpose: string;
  provider: string;
  qrPayload: string | null;
  paymentUrl: string | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  customer: {
    id: string;
    jid: string | null;
    chatId: string | null;
    name: string | null;
  } | null;
  bot: { id: string; name: string; type: string } | null;
}

interface BotOption {
  id: string;
  name: string;
  type: string;
}

export default function PaymentsPage() {
  const [items, setItems] = useState<PaymentData[]>([]);
  const [bots, setBots] = useState<BotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPurpose, setFilterPurpose] = useState("");
  const [filterProvider, setFilterProvider] = useState("");
  const [filterBot, setFilterBot] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "20",
    });
    if (filterStatus) params.set("status", filterStatus);
    if (filterPurpose) params.set("purpose", filterPurpose);
    if (filterProvider) params.set("provider", filterProvider);
    if (filterBot) params.set("botId", filterBot);
    const [payRes, botRes] = await Promise.all([
      fetch(`/api/user/payments?${params}`).then((r) => r.json()),
      fetch("/api/user/bots").then((r) => r.json()),
    ]);
    setItems(payRes.items || []);
    setTotal(payRes.total || 0);
    setBots(botRes.bots || []);
    setLoading(false);
  }, [page, filterStatus, filterPurpose, filterProvider, filterBot]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-700",
      paid: "bg-green-100 text-green-700",
      expired: "bg-gray-100 text-gray-700",
      failed: "bg-red-100 text-red-700",
      cancelled: "bg-gray-200 text-gray-700",
    };
    return map[status] || "bg-gray-100 text-gray-700";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pembayaran QRIS</h1>
        <p className="text-sm text-gray-500">
          Riwayat pembayaran via /buynow dan /topup
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm"
        >
          <option value="">Semua Status</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="expired">Expired</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={filterPurpose}
          onChange={(e) => {
            setFilterPurpose(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm"
        >
          <option value="">Semua Tujuan</option>
          <option value="topup">Topup</option>
          <option value="buynow">Buy Now</option>
        </select>
        <select
          value={filterProvider}
          onChange={(e) => {
            setFilterProvider(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm"
        >
          <option value="">Semua Provider</option>
          <option value="eqris">EQRIS</option>
          <option value="pakasir">Pakasir</option>
        </select>
        <select
          value={filterBot}
          onChange={(e) => {
            setFilterBot(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm"
        >
          <option value="">Semua Bot</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.type})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Order ID</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium">Bot</th>
                  <th className="text-left px-4 py-3 font-medium">Tujuan</th>
                  <th className="text-left px-4 py-3 font-medium">Provider</th>
                  <th className="text-right px-4 py-3 font-medium">Jumlah</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Dibuat</th>
                  <th className="text-left px-4 py-3 font-medium">Dibayar</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-gray-50 dark:border-slate-800"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{p.orderId}</td>
                    <td className="px-4 py-3 text-xs">
                      {p.customer ? (
                        <>
                          <div className="font-medium">
                            {p.customer.name || "-"}
                          </div>
                          <div className="text-gray-500 font-mono">
                            {p.customer.jid || p.customer.chatId || "-"}
                          </div>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.bot ? (
                        <span
                          className={`px-2 py-0.5 rounded-full ${p.bot.type === "telegram" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}
                        >
                          {p.bot.name}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 capitalize">
                        {p.purpose}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs uppercase font-medium">
                      {p.provider}
                    </td>
                    <td className="px-4 py-3 font-bold text-right">
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${statusBadge(p.status)}`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(p.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {p.paidAt ? formatDate(p.paidAt) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length === 0 && (
            <p className="text-center text-gray-400 py-8">
              Belum ada pembayaran
            </p>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Halaman {page} dari {totalPages} ({total} pembayaran)
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50"
            >
              Sebelumnya
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50"
            >
              Selanjutnya
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
