'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { BlueprintData } from '@/types/blueprint'

interface SavedProject {
  id: string
  name: string
  createdAt: string
  thumbnailUrl: string | null
  data: BlueprintData
}

function ProjectCard({ project, onDelete }: { project: SavedProject; onDelete: (id: string) => void }) {
  const roomCount = project.data.rooms?.length ?? 0
  const buildingType = project.data.buildingType ?? 'Unknown'
  const sqft = project.data.dimensions?.totalSqft

  const confidence = project.data.confidence
  const confidenceColor =
    confidence === 'high'
      ? 'text-[#4ecdc4]/70 border-[#4ecdc4]/20'
      : confidence === 'medium'
      ? 'text-yellow-400/70 border-yellow-400/20'
      : 'text-red-400/70 border-red-400/20'

  return (
    <div className="group border border-white/8 hover:border-white/15 transition-all bg-[#0c0f12] flex flex-col">
      {/* Thumbnail */}
      <div className="h-36 relative overflow-hidden bg-[#080b0d] flex items-center justify-center border-b border-white/5">
        {project.thumbnailUrl ? (
          <img
            src={project.thumbnailUrl}
            alt={project.name}
            className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity"
          />
        ) : (
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `
                linear-gradient(rgba(78,205,196,1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(78,205,196,1) 1px, transparent 1px)
              `,
              backgroundSize: '14px 14px',
            }}
          />
        )}
        <div className="absolute top-2 right-2">
          <span className={`font-mono text-[9px] tracking-widest uppercase px-2 py-0.5 border ${confidenceColor}`}>
            {confidence ?? 'unknown'}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="px-4 py-3 flex-1 flex flex-col gap-1.5">
        <p className="font-mono text-xs text-white/75 truncate">{project.name}</p>
        <p className="font-mono text-[10px] text-white/30 truncate">{buildingType}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="font-mono text-[10px] text-white/25">
            {roomCount} room{roomCount !== 1 ? 's' : ''}
          </span>
          {sqft && (
            <span className="font-mono text-[10px] text-white/25">{sqft} ft²</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between">
        <span className="font-mono text-[10px] text-white/20">
          {new Date(project.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDelete(project.id)}
            className="font-mono text-[10px] text-white/20 hover:text-red-400/60 transition-colors tracking-widest uppercase"
          >
            Delete
          </button>
          <Link
            href={`/analyze?project=${project.id}`}
            className="font-mono text-[10px] text-[#4ecdc4]/50 hover:text-[#4ecdc4]/80 transition-colors tracking-widest uppercase"
          >
            Open →
          </Link>
        </div>
      </div>
    </div>
  )
}

function EmptyProjects() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-6">
      <div
        className="w-24 h-24 opacity-5"
        style={{
          backgroundImage: `
            linear-gradient(rgba(78,205,196,1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(78,205,196,1) 1px, transparent 1px)
          `,
          backgroundSize: '12px 12px',
        }}
      />
      <div className="space-y-2 -mt-16">
        <p className="font-mono text-xs text-white/30 tracking-widest">No projects yet</p>
        <p className="font-mono text-[11px] text-white/15">
          Analyzed blueprints will appear here
        </p>
      </div>
      <Link
        href="/analyze"
        className="px-6 py-2.5 border border-[#4ecdc4]/30 text-[#4ecdc4]/70 font-mono text-xs tracking-widest uppercase hover:bg-[#4ecdc4]/10 transition-all"
      >
        Upload Blueprint →
      </Link>
    </div>
  )
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<SavedProject[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Load from localStorage (swap for DB/Blob fetch when backend is ready)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('architectai_projects')
      if (raw) setProjects(JSON.parse(raw))
    } catch {
      // ignore
    }
    setLoaded(true)
  }, [])

  const handleDelete = (id: string) => {
    const updated = projects.filter((p) => p.id !== id)
    setProjects(updated)
    localStorage.setItem('architectai_projects', JSON.stringify(updated))
  }

  const buildingTypes = ['all', ...Array.from(new Set(projects.map((p) => p.data.buildingType ?? 'Unknown')))]

  const filtered = projects.filter((p) => {
    const matchType = filter === 'all' || (p.data.buildingType ?? 'Unknown') === filter
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="bg-white/[0.04] border border-white/8 px-3 py-2 font-mono text-[11px] text-white/60 placeholder:text-white/20 focus:outline-none focus:border-[#4ecdc4]/30 w-56"
          />
          {buildingTypes.length > 1 && (
            <div className="flex gap-1">
              {buildingTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase transition-all ${
                    filter === type
                      ? 'bg-[#4ecdc4]/10 text-[#4ecdc4]/80 border border-[#4ecdc4]/20'
                      : 'text-white/25 border border-transparent hover:text-white/45'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-white/20">
            {filtered.length} project{filtered.length !== 1 ? 's' : ''}
          </span>
          <Link
            href="/analyze"
            className="px-4 py-2 bg-[#4ecdc4] text-[#0a0d0f] font-mono text-[11px] tracking-widest uppercase font-bold hover:bg-white transition-colors"
          >
            + New
          </Link>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {!loaded ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-white/5 h-56 animate-pulse bg-white/[0.02]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyProjects />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((project) => (
              <ProjectCard key={project.id} project={project} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}