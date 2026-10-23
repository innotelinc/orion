import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArchiveRestore,
  ArrowDownToLine,
  Boxes,
  Camera,
  Clapperboard,
  Cloud,
  Film,
  FileText,
  FolderOpen,
  Gauge,
  House,
  Images,
  KeyRound,
  Music,
  PlayCircle,
  RefreshCw,
  Settings,
  Sparkles,
  Store,
  Users,
  Video,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  FolderOpen,
  Images,
  PlayCircle,
  Store,
  ArchiveRestore,
  Boxes,
  Settings,
  Activity,
  Camera,
  Clapperboard,
  Film,
  RefreshCw,
  KeyRound,
  Gauge,
  House,
  FileText,
  Video,
  Cloud,
  Music,
  ArrowDownToLine,
  Users,
}

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Sparkles
}
