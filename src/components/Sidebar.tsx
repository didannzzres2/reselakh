"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  QrCode,
  ArrowLeftRight,
  BadgeDollarSign,
  Ticket,
  HardDrive,
  Bot,
  FolderTree,
  Package,
  Layers,
  Database,
  Wallet,
  Send,
  ShoppingCart,
  CreditCard,
  Menu,
  X,
  LogOut,
  ChevronDown,
  UserCircle,
} from "lucide-react";

const adminMenu = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Kelola User", href: "/admin/users", icon: Users },
  { name: "Reseller", href: "/admin/resellers", icon: UserCircle },
  { name: "QRIS Server", href: "/admin/qris", icon: QrCode },
  { name: "Mutasi", href: "/admin/mutations", icon: ArrowLeftRight },
  { name: "Withdrawal", href: "/admin/withdrawals", icon: BadgeDollarSign },
  { name: "Voucher", href: "/admin/vouchers", icon: Ticket },
  { name: "Backup", href: "/admin/backup", icon: HardDrive },
];

const userMenu = [
  { name: "Dashboard", href: "/panel", icon: LayoutDashboard },
  { name: "Bot Management", href: "/panel/bots", icon: Bot },
  { name: "Kategori", href: "/panel/categories", icon: FolderTree },
  { name: "Produk", href: "/panel/products", icon: Package },
  { name: "Variasi & Stock", href: "/panel/stocks", icon: Layers },
  { name: "Order", href: "/panel/orders", icon: ShoppingCart },
  { name: "Customer", href: "/panel/customers", icon: UserCircle },
  { name: "Pembayaran QRIS", href: "/panel/payments", icon: CreditCard },
  { name: "Mutasi Saldo", href: "/panel/mutations", icon: ArrowLeftRight },
  { name: "Pilih QRIS", href: "/panel/qris", icon: QrCode },
  { name: "Voucher", href: "/panel/vouchers", icon: Ticket },
  { name: "Withdraw", href: "/panel/withdraw", icon: Wallet },
  { name: "Broadcast", href: "/panel/broadcast", icon: Send },
  { name: "Reseller", href: "/panel/resellers", icon: Database },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const isAdmin = user?.role === "admin";
  const menuItems = isAdmin ? adminMenu : userMenu;

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-xl bg-white/90 dark:bg-slate-800/90 shadow-lg backdrop-blur"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-slate-800">
          <Link href={isAdmin ? "/admin" : "/panel"} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Reselakh
            </span>
          </Link>
          <button onClick={() => setOpen(false)} className="lg:hidden p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {menuItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/25"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800"
                }`}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-gray-100 dark:border-slate-800 p-3">
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
                {user?.username?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium truncate">{user?.username}</p>
                <p className="text-xs text-gray-500 truncate">
                  {isAdmin ? "Administrator" : "User"}
                </p>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence>
              {userMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden"
                >
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </aside>
    </>
  );
}
