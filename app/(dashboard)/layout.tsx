"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Project {
  id: string;
  name: string;
  createdAt: string;
  messages: any[];
}

const navItems = [
  {
    href: "/analyze",
    label: "Analyze",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    href: "/projects",
    label: "Projects",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);

  const loadProjects = () => {
    try {
      const stored = localStorage.getItem("architectai_projects");
      if (stored) {
        const parsed = JSON.parse(stored) as Project[];
        setProjects(parsed.slice(0, 5));
      } else {
        setProjects([]);
      }
    } catch (err) {
      console.error("Failed to load projects inside layout framework:", err);
    }
  };

  useEffect(() => {
    loadProjects();
    window.addEventListener("storage", loadProjects);
    return () => window.removeEventListener("storage", loadProjects);
  }, []);

  return (
    <div className="flex h-screen bg-[#0a0d0f] text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[220px] flex-shrink-0 flex flex-col border-r border-white/5 bg-[#0c0f12]">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/5">
          <div className="w-7 h-7 border border-[#4ecdc4]/60 rotate-45 flex items-center justify-center flex-shrink-0">
            <div className="w-2.5 h-2.5 bg-[#4ecdc4] rotate-[-45deg]" />
          </div>
          <Link
            href="/"
            className="font-mono text-xs tracking-[0.18em] uppercase text-white/70"
          >
            ArchitectAI
          </Link>
        </div>

        {/* Nav */}
        <nav className="px-3 py-4 space-y-1">
          <p className="px-2 mb-3 text-[10px] font-mono tracking-widest uppercase text-white/20">
            Workspace
          </p>
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm font-mono transition-all ${
                  active
                    ? "bg-[#4ecdc4]/10 text-[#4ecdc4] border border-[#4ecdc4]/20"
                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border border-transparent"
                }`}
              >
                <span className={active ? "text-[#4ecdc4]" : "text-white/30"}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Recent Sessions */}
        <div className="flex-1 px-3 py-2 border-t border-white/[0.02] overflow-y-auto hidden-scrollbar">
          <p className="px-2 mt-2 mb-3 text-[10px] font-mono tracking-widest uppercase text-white/20">
            Recent Analysis
          </p>

          {projects.length === 0 ? (
            <p className="px-2 text-xs font-mono text-white/10 italic">
              No recent sessions
            </p>
          ) : (
            <div className="space-y-1">
              {projects.map((proj) => {
                const activeSession = pathname.includes(proj.id);
                return (
                  <button
                    key={proj.id}
                    onClick={() => router.push(`/analyze?id=${proj.id}`)}
                    className={`w-full text-left flex flex-col gap-0.5 px-3 py-2 rounded font-mono transition-all border group ${
                      activeSession
                        ? "bg-white/[0.04] border-white/10 text-white"
                        : "border-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
                    }`}
                  >
                    <span className="text-xs truncate block w-full">
                      {proj.name}
                    </span>
                    <span className="text-[9px] text-white/20 group-hover:text-white/30 transition-colors">
                      {proj.messages?.length || 0} messages
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom status */}
        <div className="px-5 py-4 border-t border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4ecdc4] animate-pulse" />
            <span className="font-mono text-[10px] text-white/25 tracking-wider">
              System Online
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#0a0d0f] flex-shrink-0">
          <div>
            <h1 className="text-sm font-mono text-white/60 tracking-wider capitalize">
              {pathname.replace("/", "") || "Dashboard"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="font-mono text-[11px] text-white/25 hover:text-white/50 tracking-widest uppercase transition-colors"
            >
              ← Home
            </Link>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
