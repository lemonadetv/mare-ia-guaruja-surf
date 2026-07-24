# Maré IA — deploy no Vercel

Pasta pronta para publicar. Nao precisa de build.

## Opcao A — arrastar (mais rapido)
1. Instale o CLI: `npm i -g vercel`
2. Dentro desta pasta rode: `vercel` e depois `vercel --prod`
3. Aceite os padroes. Framework: **Other**. Build command: vazio. Output directory: `./`

## Opcao B — pelo site
1. Crie um repositorio no GitHub com o conteudo desta pasta.
2. vercel.com -> Add New -> Project -> importe o repo.
3. Framework Preset: **Other**. Build Command: vazio. Output Directory: `./`. Deploy.

## Instalar no telefone (sem loja)
1. Abra a URL `https://....vercel.app` no **Chrome do Android**.
2. Menu (tres pontos) -> **Instalar app** / **Adicionar a tela inicial**.
3. O app abre em tela cheia, com icone proprio, e funciona offline.

## Arquivos
- `index.html` — app completo, autocontido (fontes embutidas)
- `manifest.webmanifest` — nome, icones, tela cheia
- `sw.js` — service worker (offline)
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`
- `vercel.json` — headers de cache
