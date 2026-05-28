import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0a0d0f] w-full text-white overflow-hidden">
      {/* Grid background */}
      <div
        className="fixed opacity-20 inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Nav */}
      <nav className="flex px-8 py-8 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border border-[#4ecdc4]/60 rotate-45 flex items-center justify-center">
            <div className="w-3 h-3 bg-[#4ecdc4]" />
          </div>
          <Link
            href="/"
            className="font-mono text-lg tracking-[0.18em] uppercase text-white/70"
          >
            ArchitectAI
          </Link>
        </div>
        <div className="flex items-center gap-8 text-sm text-white/40 font-mono">
          <Link
            href="/analyze"
            className="hover:text-white/80 transition-colors"
          >
            Analyze
          </Link>
          <Link
            href="/projects"
            className="hover:text-white/80 transition-colors"
          >
            Projects
          </Link>
          <Link
            href="/analyze?new=1"
            className="px-4 py-2 border border-[#4ecdc4]/40 text-[#4ecdc4] hover:bg-[#4ecdc4]/10 transition-all text-xs tracking-widest uppercase"
          >
            Launch
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col gap-10 items-center justify-center text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 border border-[#4ecdc4]/20 text-[#4ecdc4]/70 text-xs font-mono tracking-widest uppercase mb-10">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4ecdc4] animate-pulse" />
          AI-Powered Blueprint Analysis
        </div>

        <h1
          className="font-black tracking-wide mb-8 max-w-5xl"
          style={{ fontFamily: "'Bebas Neue', 'Arial Black', sans-serif" }}
        >
          <span className="block text-white text-2xl">Read Every</span>
          <span
            className="block text-2xl"
            style={{
              WebkitTextStroke: "1px rgba(78,205,196,0.5)",
              color: "transparent",
            }}
          >
            Blueprint
          </span>
          <span className="block text-white text-2xl">Instantly</span>
        </h1>

        <p className="text-white/40 text-lg max-w-xl mb-12 font-light leading-relaxed">
          Upload any architectural drawing to extract rooms, dimensions,
          materials, and structural elements in seconds — or describe a building
          and let the AI generate a floor plan. Then ask questions about your
          design.
        </p>

        <div className="flex items-center gap-4">
          <Link
            href="/analyze?new=1"
            className="group relative px-8 py-4 bg-[#4ecdc4] text-[#0a0d0f] font-mono text-sm tracking-widest uppercase font-bold hover:bg-white transition-colors"
          >
            Upload Blueprint
            <span className="ml-3 inline-block group-hover:translate-x-1 transition-transform">
              →
            </span>
          </Link>
          <Link
            href="/projects"
            className="px-8 py-4 border border-white/10 text-white/50 font-mono text-sm tracking-widest uppercase hover:border-white/30 hover:text-white/80 transition-all"
          >
            View Projects
          </Link>
        </div>
      </section>

      {/* Feature strip */}
      <section className="relative z-10 border-t border-white/5 px-10 py-16">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
          {[
            {
              num: "01",
              title: "Vision Extraction",
              desc: "Our AI reads your blueprint image and extracts every room, dimension, annotation, and material into structured data.",
            },
            {
              num: "02",
              title: "AI Blueprint Generation",
              desc: "No drawing yet? Describe the building you want and the AI designs a floor plan — rooms, dimensions, and materials included.",
            },
            {
              num: "03",
              title: "Blueprint Chat",
              desc: "Ask any question about your drawing. Square footage, compliance notes, structural concerns — answered instantly.",
            },
          ].map((f) => (
            <div
              key={f.num}
              className="bg-[#0a0d0f] p-8 group hover:bg-white/[0.02] transition-colors"
            >
              <div className="font-mono text-xs text-[#4ecdc4]/40 tracking-widest mb-4">
                {f.num}
              </div>
              <h3 className="text-white font-semibold text-lg mb-3 tracking-tight">
                {f.title}
              </h3>
              <p className="text-white/35 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Upload CTA */}
      <section className="relative z-10 flex flex-col items-center py-24 px-6 border-t border-white/5">
        <p className="font-mono text-xs text-white/20 tracking-widest uppercase mb-6">
          Supported formats
        </p>
        <div className="flex items-center gap-6 mb-16">
          {["PNG", "JPG", "WEBP"].map((fmt) => (
            <span
              key={fmt}
              className="px-3 py-1 border border-white/10 text-white/30 font-mono text-xs"
            >
              {fmt}
            </span>
          ))}
        </div>

        <Link
          href="/analyze?new=1"
          className="group flex flex-col items-center gap-3 text-white/20 hover:text-white/60 transition-colors"
        >
          <div className="w-16 h-16 border border-white/10 group-hover:border-[#4ecdc4]/40 transition-colors flex items-center justify-center">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <span className="font-mono text-xs tracking-widest uppercase">
            Drop a blueprint to begin
          </span>
        </Link>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 px-10 py-6 flex items-center justify-between">
        <span className="font-mono text-xs text-white/15 tracking-widest">
          ArchitectAI — Powered by local AI
        </span>
        <span className="font-mono text-xs text-white/15">
          Runs on your machine via Ollama
        </span>
      </footer>
    </main>
  );
}
