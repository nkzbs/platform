import React from 'react'

// PLATFORM-UI-RESKIN-PLAN.md, Fase 0 — passato da SVG disegnate a mano a
// lucide-react (stroke outline, come vuole il mockup di riferimento).
// lucide-react iniettato dal chiamante (non importato qui): stesso motivo già
// in uso per bcrypt in shared/instance-pairing.js e per il client Redis in
// shared/rate-limit.js — shared/ non ha un proprio node_modules e non può
// risolvere un pacchetto npm da sé; ogni app (core/frontend,
// super-admin/frontend) HA il proprio node_modules e passa qui i componenti
// già importati. Stessa identica API (name/size/className) di prima per chi
// chiama <Icon .../> in tutta l'app: nessun punto di chiamata deve cambiare.
export function createIcon(lucide) {
  const ICONS = {
    home: lucide.Home, users: lucide.Users, box: lucide.Box, store: lucide.Store,
    tool: lucide.Wrench, plug: lucide.Plug, zap: lucide.Zap, user: lucide.User,
    file: lucide.File, folder: lucide.Folder, 'credit-card': lucide.CreditCard, 'bar-chart': lucide.BarChart3,
    plus: lucide.Plus, x: lucide.X, check: lucide.Check, star: lucide.Star,
    menu: lucide.Menu, edit: lucide.Pencil, trash: lucide.Trash2, logout: lucide.LogOut,
    save: lucide.Save, settings: lucide.Settings, 'arrow-up': lucide.ArrowUp,
    'arrow-down': lucide.ArrowDown, grid: lucide.LayoutGrid, link: lucide.Link,
    'git-branch': lucide.GitBranch, cpu: lucide.Cpu, 'chevron-right': lucide.ChevronRight,
    'chevron-down': lucide.ChevronDown, refresh: lucide.RefreshCw, eye: lucide.Eye,
    info: lucide.Info, 'git-compare': lucide.GitCompare, 'alert-triangle': lucide.AlertTriangle,
    'corner-down-right': lucide.CornerDownRight, search: lucide.Search, list: lucide.List,
    calendar: lucide.Calendar, download: lucide.Download, upload: lucide.Upload,
    bell: lucide.Bell, key: lucide.Key, 'chevron-left': lucide.ChevronLeft,
    'chevron-up': lucide.ChevronUp, 'eye-off': lucide.EyeOff, shield: lucide.Shield,
    sun: lucide.Sun, moon: lucide.Moon, play: lucide.Play, square: lucide.Square,
    activity: lucide.Activity, globe: lucide.Globe, sparkles: lucide.Sparkles,
    'message-circle': lucide.MessageCircle, clock: lucide.Clock, flag: lucide.Flag,
    'layout-template': lucide.LayoutTemplate, undo: lucide.Undo2, database: lucide.Database,
    // PLATFORM-UI-RESKIN-PLAN.md, Fase 2 — 4 icone in più richieste dalla
    // mappatura ruolo→icona del brief (dashboard/tenant/super-builder/audit),
    // non coperte da nessuna delle precedenti anche come sostituto ragionevole.
    dashboard: lucide.LayoutDashboard, building: lucide.Building2,
    wand: lucide.WandSparkles, clipboard: lucide.ClipboardList,
    lock: lucide.Lock,
    // Icone verticali/settore (2026-08-31) — usate come template_icon dei 15
    // casi d'uso gestionali marcati is_template=1: senza queste voci ricadevano
    // tutte in silenzio sull'icona box generica (bug reale trovato controllando
    // la mappa, non assunto). 'life-buoy' per la nuova voce "Assistenza".
    'shopping-cart': lucide.ShoppingCart, 'hard-hat': lucide.HardHat,
    factory: lucide.Factory, receipt: lucide.Receipt, scale: lucide.Scale,
    bed: lucide.Bed, utensils: lucide.Utensils, calculator: lucide.Calculator,
    wallet: lucide.Wallet, shirt: lucide.Shirt, leaf: lucide.Leaf, cog: lucide.Cog,
    'user-check': lucide.UserCheck, 'life-buoy': lucide.LifeBuoy,
    'external-link': lucide.ExternalLink,
    // Maniglia di trascinamento per il drag-and-drop di Sito Web (2026-09-04).
    'grip-vertical': lucide.GripVertical,
    // Pannello "Richieste ricevute" del blocco 'form' di Sito Web (2026-09-05).
    inbox: lucide.Inbox,
    // Connessione email (Resend) per il form di contatto (2026-09-05).
    mail: lucide.Mail,
    // Anteprima responsive per dispositivo nell'editor Sito Web (2026-09-05).
    monitor: lucide.Monitor, tablet: lucide.Tablet, smartphone: lucide.Smartphone,
  }

  // stroke 1.6-1.8 per il brief — 1.75 come compromesso singolo invece di
  // differenziare per size (il set attuale non lo richiede).
  // +5% (2026-09-04, richiesto dall'utente, "ovunque") — scalato qui, unica
  // fonte condivisa da core/frontend E super-admin/frontend, invece di
  // toccare ogni singola chiamata size={...} in entrambe le app.
  return function Icon({ name, size = 16, className = '' }) {
    const Cmp = ICONS[name] || ICONS.box
    return <Cmp size={size * 1.05} strokeWidth={1.75} className={className} />
  }
}
