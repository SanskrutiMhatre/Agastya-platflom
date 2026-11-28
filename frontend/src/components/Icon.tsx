import { createElement } from 'react';
import {
  type IconNode, Activity, Bell, ExternalLink, ArrowLeft, BookMarked, Check, ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, CircleAlert, CircleCheck, Clock, Copy, Download,
  Eye, FileCode2, FileText, Folder, FolderKanban, FolderOpen, FolderPlus, History, House, Info, KeyRound, LayoutDashboard, ListTree, Lock, LogOut, Moon,
  PanelLeft, Pencil, Play, Plus, RefreshCw, Rocket, Search, Settings, ShieldCheck, Stamp, Sun, Trash2, TriangleAlert, Unlock, Upload, UserPlus, Users, X, FileDown,
  PenLine, Network, Monitor, Server, Layers, CircleUser, Image, Library, Wrench, SlidersHorizontal, MessageSquare, Send, Undo2, Package,
  Keyboard, Maximize2, Minimize2, GitCompare, Command,
  Flag, Funnel, CircleX, Cpu, Database, HardDrive, Archive, WifiOff, BookOpen, Ban, ListOrdered, Ellipsis, ZoomIn, ZoomOut, ChevronLeft, Save, Link, ListChecks, Hash,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  activity: Activity, bell: Bell, external: ExternalLink, back: ArrowLeft, book: BookMarked, check: Check, down: ChevronDown, up: ChevronUp, right: ChevronRight, collapse: ChevronsDownUp, expand: ChevronsUpDown,
  alert: CircleAlert, ok: CircleCheck, clock: Clock, copy: Copy, download: Download, eye: Eye, xml: FileCode2, file: FileText, folder: Folder, projects: FolderKanban,
  folderOpen: FolderOpen, folderPlus: FolderPlus, history: History, home: House, info: Info, key: KeyRound, dashboard: LayoutDashboard, tree: ListTree, lock: Lock,
  logout: LogOut, moon: Moon, panel: PanelLeft, edit: Pencil, play: Play, plus: Plus, refresh: RefreshCw, rocket: Rocket, search: Search, settings: Settings,
  shield: ShieldCheck, stamp: Stamp, sun: Sun, trash: Trash2, warn: TriangleAlert, unlock: Unlock, upload: Upload, invite: UserPlus, users: Users, close: X,
  pdf: FileDown, editor: PenLine, explore: Network, monitor: Monitor, server: Server, layers: Layers,
  user: CircleUser, image: Image, library: Library, wrench: Wrench, sliders: SlidersHorizontal, comment: MessageSquare, send: Send, undo: Undo2, package: Package,
  // WP-21: the editor host chrome (shortcuts, focus mode, conflict comparison, command palette)
  keyboard: Keyboard, focus: Maximize2, unfocus: Minimize2, compare: GitCompare, command: Command,
  // UI redesign step 1: the icons the approved mockups draw (docs/audit/mockups)
  flag: Flag, filter: Funnel, xcircle: CircleX, cpu: Cpu, database: Database, disk: HardDrive, archive: Archive, offline: WifiOff, book2: BookOpen, ban: Ban,
  listOrdered: ListOrdered, more: Ellipsis, zoomIn: ZoomIn, zoomOut: ZoomOut, left: ChevronLeft, save: Save, link: Link, listChecks: ListChecks, hash: Hash,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const node = ICONS[name];
  return createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className, focusable: false },
    ...(node ?? []).map(([tag, attrs], i) => createElement(tag, { ...(attrs as Record<string, unknown>), key: i })),
  );
}
