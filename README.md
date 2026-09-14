# agent-webui

Agent chat SPA over `agent.v1.AgentService` (Connect). **Svelte 5 (runes) +
shadcn-svelte style components (bits-ui primitives) + lucide icons + Tailwind
v4**, with the Flutter app's **sqlite-wasm (OPFS)** local mirror and a
**PWA** (installable, offline shell).

Full parity with `abcp-sdk/flutter`: setup gate + backend manager, session
list (search / multi-select / unread / live watchSessions), chat (local-first
sync, streaming bubbles with reasoning + tool cards, drafts, attachments,
voice), mailbox, config (appearance / backends / providers + gateway +
models / presets / tools) and zh-en i18n.

## Run

```bash
npm install
npm run dev        # vite dev server
npm run build      # PWA production build -> dist/
npm run check      # svelte-check + tsc
```

## Deploy (dev pod)

Served by nginx/Caddy from `dist/` with `/agent/*` reverse-proxied to the
agent backend; OPFS needs a secure context (https).

## Layout

```
src/
├── App.svelte            # setup gate + backends manager + root
├── lib/
│   ├── components/ui/    # shadcn-style primitives (button/dialog/select/…)
│   ├── components/       # MessageBubble, ToolPartView, MediaAttachment, SessionRow
│   ├── pages/            # Chat, SessionList, Config, Mailbox, providers/*
│   ├── api.ts            # AgentApi facade over @abcp/agent-sdk
│   ├── store.svelte.ts   # sessions / drafts / nav stacks
│   ├── messages.svelte.ts# streaming controller
│   ├── db.ts             # sqlite-wasm (OPFS) mirror
│   ├── i18n.svelte.ts    # zh/en (generated from the Flutter arb)
│   └── voice.ts          # MediaRecorder
└── main.ts               # mount + PWA service worker
```
