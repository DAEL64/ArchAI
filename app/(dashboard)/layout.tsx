"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { SavedProject } from "@/types/blueprint";
import { projectsApi } from "@/lib/api/projects";
import { AnalysisSessionProvider } from "./analysis-session-provider";

/**
 * Renders the recent-projects buttons. Reads ?id from the URL to highlight the
 * active session, so it MUST live inside a <Suspense> boundary (Next 16 fails
 * the build if useSearchParams is used without one).
 */
function RecentProjectsList({
  projects,
  pathname,
  onOpen,
}: {
  projects: SavedProject[];
  pathname: string;
  onOpen: (id: string) => void;
}) {
  const activeProjectId = useSearchParams().get("id");

  return (
    <div className="space-y-1">
      {projects.map((proj) => {
        const activeSession =
          pathname === "/analyze" && activeProjectId === proj.id;

        return (
          <button
            key={proj.id}
            onClick={() => onOpen(proj.id)}
            className={`w-full text-left flex flex-col gap-0.5 px-3 py-2 rounded font-mono transition-all border group ${
              activeSession
                ? "bg-white/[0.04] border-white/10 text-white"
                : "border-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
            }`}
          >
            <span className="text-xs truncate block w-full">{proj.name}</span>
            <span className="text-[9px] text-white/20 group-hover:text-white/30 transition-colors">
              {proj.messages?.length || 0} messages
            </span>
          </button>
        );
      })}
    </div>
  );
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
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const loadProjects = useCallback(async () => {
    try {
      const data = await projectsApi.list();
      setProjects(data.slice(0, 5));
    } catch (err) {
      console.error("Failed to load projects inside layout:", err);
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    loadProjects();

    window.addEventListener("architectai-projects-updated", loadProjects);

    return () => {
      window.removeEventListener("architectai-projects-updated", loadProjects);
    };
  }, [loadProjects]);

  return (
    <div className="flex h-screen bg-[#0a0d0f] text-white overflow-hidden">
      {/* mobile drawer backdrop */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[240px] flex-shrink-0 flex flex-col border-r border-white/5 bg-[#0c0f12] transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
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

        <div className="flex-1 px-3 py-2 border-t border-white/[0.02] overflow-y-auto hidden-scrollbar">
          <p className="px-2 mt-2 mb-3 text-[10px] font-mono tracking-widest uppercase text-white/20">
            Recent Sessions
          </p>

          {projects.length === 0 ? (
            <p className="px-2 text-xs font-mono text-white/10 italic">
              No recent sessions
            </p>
          ) : (
            <Suspense fallback={null}>
              <RecentProjectsList
                projects={projects}
                pathname={pathname}
                onOpen={(id) => {
                  setDrawerOpen(false);
                  router.push(`/analyze?id=${id}`);
                }}
              />
            </Suspense>
          )}
        </div>

        <div className="px-5 py-4 border-t border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4ecdc4] animate-pulse" />
            <span className="font-mono text-[10px] text-white/25 tracking-wider">
              System Online
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col">
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/5 bg-[#0a0d0f] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="lg:hidden flex-shrink-0 w-9 h-9 -ml-1 flex items-center justify-center rounded-md border border-white/10 text-white/60 hover:text-white/90 hover:border-white/20 transition"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <h1 className="text-sm font-mono text-white/60 tracking-wider capitalize truncate">
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

        <AnalysisSessionProvider>
          <div className="flex-1 overflow-hidden">{children}</div>
        </AnalysisSessionProvider>
      </main>
    </div>
  );
}
