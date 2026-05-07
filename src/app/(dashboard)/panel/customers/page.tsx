"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Pencil, Trash2 } from "lucide-react";
import Spinner from "@/components/loading/Spinner";
import { formatCurrency, formatDate } from "@/lib/utils";

interface CustomerData {
  id: string;
  botId: string;
  jid: string | null;
  chatId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  balance: number;
  status: string;
  createdAt: string;
  bot: { id: string; name: string; type: string } | null;
}

interface BotOption {
  id: string;
  name: string;
  type: string;
}

interface CreateForm {
  botId: string;
  jid: string;
  chatId: string;
  name: string;
  phone: string;
  email: string;
  initialBalance: string;
}

interface AdjustForm {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  balanceAdjustment: string;
  adjustmentNote: string;
}

const emptyCreate = (): CreateForm => ({
  botId: "",
  jid: "",
  chatId: "",
  name: "",
  phone: "",
  email: "",
  initialBalance: "0",
});

export default function CustomersPage() {
  const [items, setItems] = useState<CustomerData[]>([]);
  const [bots, setBots] = useState<BotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filterBot, setFilterBot] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate());
  const [editForm, setEditForm] = useState<AdjustForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "20",
    });
    if (search) params.set("q", search);
    if (filterBot) params.set("botId", filterBot);
    const [custRes, botRes] = await Promise.all([
      fetch(`/api/user/customers?${params}`).then((r) => r.json()),
      fetch("/api/user/bots").then((r) => r.json()),
    ]);
    setItems(custRes.items || []);
    setTotal(custRes.total || 0);
    setBots(botRes.bots || []);
    setLoading(false);
  }, [page, search, filterBot]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => {
    setCreateForm({ ...emptyCreate(), botId: bots[0]?.id || "" });
    setError(null);
    setCreateOpen(true);
  };

  const openEdit = (c: CustomerData) => {
    setEditForm({
      id: c.id,
      name: c.name || "",
      phone: c.phone || "",
      email: c.email || "",
      status: c.status,
      balanceAdjustment: "",
      adjustmentNote: "",
    });
    setError(null);
    setEditOpen(true);
  };

  const handleCreate = async () => {
    setError(null);
    if (!createForm.botId) {
      setError("Pilih bot dulu");
      return;
    }
    if (!createForm.jid && !createForm.chatId) {
      setError("Isi JID (WA) atau Chat ID (Telegram)");
      return;
    }
    const payload = {
      botId: createForm.botId,
      jid: createForm.jid || null,
      chatId: createForm.chatId || null,
      name: createForm.name || null,
      phone: createForm.phone || null,
      email: createForm.email || null,
      initialBalance: parseInt(createForm.initialBalance || "0") || 0,
    };
    const res = await fetch("/api/user/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Gagal membuat customer");
      return;
    }
    setCreateOpen(false);
    fetchData();
  };

  const handleSaveEdit = async () => {
    if (!editForm) return;
    setError(null);
    const adj = editForm.balanceAdjustment.trim();
    const payload: Record<string, unknown> = {
      id: editForm.id,
      name: editForm.name || null,
      phone: editForm.phone || null,
      email: editForm.email || null,
      status: editForm.status,
    };
    if (adj && !Number.isNaN(parseInt(adj))) {
      payload.balanceAdjustment = parseInt(adj);
      if (editForm.adjustmentNote) {
        payload.adjustmentNote = editForm.adjustmentNote;
      }
    }
    const res = await fetch("/api/user/customers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Gagal menyimpan");
      return;
    }
    setEditOpen(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus customer ini? Mutasi tetap tercatat.")) return;
    await fetch("/api/user/customers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchData();
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Customer</h1>
          <p className="text-sm text-gray-500">
            Kelola pelanggan dari bot Telegram dan WhatsApp
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium text-sm"
        >
          <Plus className="w-4 h-4" /> Tambah Customer
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          placeholder="Cari nama, JID, atau chat ID..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="flex-1 min-w-[200px] px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm"
        />
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
                  <th className="text-left px-4 py-3 font-medium">Nama</th>
                  <th className="text-left px-4 py-3 font-medium">Bot</th>
                  <th className="text-left px-4 py-3 font-medium">
                    JID / Chat ID
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Kontak</th>
                  <th className="text-right px-4 py-3 font-medium">Saldo</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Dibuat</th>
                  <th className="text-right px-4 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-gray-50 dark:border-slate-800"
                  >
                    <td className="px-4 py-3 font-medium">{c.name || "-"}</td>
                    <td className="px-4 py-3 text-xs">
                      {c.bot ? (
                        <span
                          className={`px-2 py-0.5 rounded-full ${c.bot.type === "telegram" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}
                        >
                          {c.bot.name}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">
                      {c.jid || c.chatId || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="space-y-0.5">
                        {c.email && (
                          <div className="text-gray-700 dark:text-gray-300">
                            {c.email}
                          </div>
                        )}
                        {c.phone && (
                          <div className="text-gray-500 font-mono">
                            {c.phone}
                          </div>
                        )}
                        {!c.email && !c.phone && "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-bold text-right">
                      {formatCurrency(c.balance)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${c.status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(c.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="p-1.5 rounded-lg hover:bg-red-100 text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length === 0 && (
            <p className="text-center text-gray-400 py-8">
              Belum ada customer
            </p>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Halaman {page} dari {totalPages} ({total} customer)
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

      <AnimatePresence>
        {createOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Tambah Customer</h3>
                <button
                  onClick={() => setCreateOpen(false)}
                  className="p-1 rounded-lg hover:bg-gray-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3">
                <select
                  value={createForm.botId}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, botId: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                >
                  <option value="">Pilih bot</option>
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.type})
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Nama (opsional)"
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, name: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                />
                <input
                  placeholder="Email (opsional)"
                  type="email"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, email: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm"
                />
                <input
                  placeholder="No. HP (opsional)"
                  value={createForm.phone}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, phone: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm font-mono"
                />
                <input
                  placeholder="JID WhatsApp (628xxx@s.whatsapp.net)"
                  value={createForm.jid}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, jid: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm font-mono"
                />
                <input
                  placeholder="Chat ID Telegram"
                  value={createForm.chatId}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, chatId: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm font-mono"
                />
                <input
                  placeholder="Saldo awal (Rupiah)"
                  type="number"
                  min="0"
                  value={createForm.initialBalance}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      initialBalance: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                />
                {error && (
                  <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">
                    {error}
                  </p>
                )}
                <button
                  onClick={handleCreate}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium"
                >
                  Tambah
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {editOpen && editForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Edit Customer</h3>
                <button
                  onClick={() => setEditOpen(false)}
                  className="p-1 rounded-lg hover:bg-gray-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3">
                <input
                  placeholder="Nama"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                />
                <input
                  placeholder="Email"
                  type="email"
                  value={editForm.email}
                  onChange={(e) =>
                    setEditForm({ ...editForm, email: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm"
                />
                <input
                  placeholder="No. HP"
                  value={editForm.phone}
                  onChange={(e) =>
                    setEditForm({ ...editForm, phone: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm font-mono"
                />
                <select
                  value={editForm.status}
                  onChange={(e) =>
                    setEditForm({ ...editForm, status: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                >
                  <option value="active">active</option>
                  <option value="blocked">blocked</option>
                </select>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Penyesuaian Saldo (positif = tambah, negatif = kurang)
                  </label>
                  <input
                    placeholder="0"
                    type="number"
                    value={editForm.balanceAdjustment}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        balanceAdjustment: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                  />
                </div>
                <input
                  placeholder="Catatan penyesuaian"
                  value={editForm.adjustmentNote}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      adjustmentNote: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                />
                {error && (
                  <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">
                    {error}
                  </p>
                )}
                <button
                  onClick={handleSaveEdit}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium"
                >
                  Simpan
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
