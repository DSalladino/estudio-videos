# Estúdio de Vídeos

Painel local que transforma um tema em vídeo pronto: escreve o roteiro, narra, coloca as legendas
sincronizadas, anima as cenas e entrega um MP4 vertical (9:16) ou horizontal (16:9).

Feito para uso próprio, rodando na sua máquina. Nada é enviado para servidor nenhum além da
narração (voz do Microsoft Edge) e da IA, se você configurar uma.

---

## Como abrir

1. Tenha o **Node.js 18+** instalado (`node -v` no terminal).
2. Dê **duplo clique em `INICIAR.bat`**.
   Na primeira vez ele instala as dependências e abre o painel em `http://127.0.0.1:4321`.

Ou pelo terminal:

```bash
npm install
npm start
```

### Testar sem instalar nada (GitHub Codespaces)

O repositório já vem com um `.devcontainer` configurado. Abra
`https://codespaces.new/DSalladino/estudio-videos` → o Codespace instala as dependências, sobe o
painel e abre a porta 4321 num link `https://<nome>-4321.app.github.dev`, que você pode usar de
qualquer navegador (inclusive do celular).

O Codespaces roda em máquina compartilhada: funciona igual, só renderiza mais devagar que no seu PC.
Os vídeos ficam dentro do Codespace (pasta `output/`) e some quando ele é apagado — baixe o MP4
pelo botão da biblioteca.

## O fluxo no painel

1. **Tema** — uma linha, uma pergunta, uma história.
2. **Gerar roteiro** — a IA escreve as cenas (ou você cola um roteiro pronto, ou escreve na mão).
3. **Renderizar vídeo** — ele narra, monta o áudio, desenha os frames e encoda o MP4.
4. O arquivo aparece em **Vídeos prontos** para assistir e baixar. Também fica em `output/`.

Tudo é editável antes de renderizar: você pode reescrever cada cena, trocar o texto que aparece
na tela, remover e adicionar cenas.

## Estilos incluídos

| Estilo | Cara | Bom para |
| --- | --- | --- |
| **Kinetic Creme** | papel creme, tipografia gigante, palavras surgindo no ritmo da voz | curiosidades, histórias, opinião |
| **HUD Cyberpunk** | grade neon, brilho, texto em máquina de escrever, HUD de gravação | tecnologia, IA, mistérios |
| **Pixel 8-bit** | caixa de diálogo de videogame, pixels grossos, neon | games, listas, nostalgia |
| **Documental Bold** | fundo com zoom lento, texto Impact e palavra destacada em vermelho | canal dark, geopolítica, finanças |

Cada estilo funciona em 9:16, 16:9 e 1:1. Se a cena tiver **texto na tela**, ele vira a manchete e
a narração aparece como legenda; se não tiver, a própria narração vira o texto grande em blocos
que acompanham a fala (karaokê).

## O que você pode colocar nas pastas

- `assets/broll/` — fotos ou imagens (jpg, png, webp). O estilo **Documental Bold** usa essas
  imagens como fundo, com zoom lento. Pode criar subpastas por nicho.
- `assets/music/` — trilhas em mp3/wav/m4a/ogg. Aparecem no seletor "Música de fundo" e entram em
  loop por baixo da narração, com fade in/out.
- `assets/fonts/` — fontes `.ttf`/`.otf` extras (úteis se você for criar estilos novos).

## IA do roteiro (opcional)

O botão **Configurar IA** aceita qualquer API compatível com OpenAI:

| Provedor | Endereço | Modelo de exemplo |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1` | `google/gemini-2.0-flash-001` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1` |

Sem chave o painel continua funcionando: ele monta um esqueleto de roteiro e você escreve em cima,
ou cola um roteiro pronto. A chave fica em `config.json`, na sua máquina.

## Voz

A narração usa as vozes neurais do Microsoft Edge (gratuitas, sem chave, precisam de internet):
`pt-BR-FranciscaNeural` (padrão), `pt-BR-ThalitaMultilingualNeural` e `pt-BR-AntonioNeural`.
A velocidade é ajustável no painel. Se o serviço estiver fora do ar, o app cai para a voz do
Windows para o vídeo não deixar de sair.

## Como funciona por dentro

```
src/
  server.mjs            servidor HTTP + API + streaming dos vídeos
  jobs.mjs              fila de renderização (um vídeo por vez) e progresso via SSE
  config.mjs            config.json (IA, padrões)
  pipeline/
    script.mjs          roteiro: IA, esqueleto local ou divisão de texto colado
    tts.mjs             narração + tempos de cada palavra (Edge TTS)
    audio.mjs           junta narração, silêncios e música; normaliza volume
    render.mjs          orquestra tudo e envia frames crus para o ffmpeg
    render/
      layout.mjs        formatos e margens
      text.mjs          ajuste de texto, quebra de linha, karaokê
      assets.mjs        imagens de fundo, grão, vinheta, estrelas
      styles/*.mjs      um arquivo por estilo visual
web/                    painel (HTML/CSS/JS puro, sem build)
```

Cada frame é desenhado com `@napi-rs/canvas` e enviado por pipe para o `ffmpeg` (binário incluído),
que encoda H.264 + AAC. O áudio é montado antes, então legenda e voz ficam sincronizadas.

### Criar um estilo novo

Copie um arquivo de `src/pipeline/render/styles/` e implemente dois métodos:

```js
export default {
  id: 'meu-estilo',
  name: 'Meu Estilo',
  description: '...',
  supports: ['9:16', '16:9', '1:1'],
  // roda uma vez por cena: medir texto, escolher fundo
  async prepare({ scene, ctx, metrics, index, background }) { return { /* estado */ }; },
  // roda a cada frame: t = segundos dentro da cena
  draw(ctx, { state, t, duration, metrics, scene, index, total }) { /* desenhar */ },
};
```

Depois registre-o em `src/pipeline/render.mjs` (`import` + entrada em `STYLES`).

## Configuração técnica

- `config.json` — IA, estilo/formato/voz padrão, volume da música.
- `PORT=4321` e `HOST=127.0.0.1` podem ser trocados por variável de ambiente.
- O servidor só escuta em `127.0.0.1`: nada na rede local acessa o painel.
- `output/` — vídeos finais + miniatura + um `.json` com os metadados de cada um.

## Se algo der errado

- **“ffmpeg não encontrado”** — o binário vem no `npm install`. Rode `npm rebuild ffmpeg-static`
  (ou `npm install --foreground-scripts`) e tente de novo. Se preferir o ffmpeg do sistema, defina
  `FFMPEG_BIN` com o caminho dele.
- **Vídeo sai sem som** — o Edge TTS precisa de internet. O servidor mostra o aviso no log e usa a
  voz do Windows como reserva.
- **Porta 4321 ocupada** — rode `PORT=4400 npm start` (Windows: `set PORT=4400 && npm start`).

## Limites (para não gerar expectativa errada)

- O visual é **motion graphics procedural**: tipografia, formas, imagens que você coloca em
  `assets/broll/`. Ele não gera imagens ou vídeos por IA.
- Vídeos de 16:9 com narração longa usam mais CPU: ~1,5x a duração do vídeo em tempo de render.
- A narração gratuita depende da internet. Sem conexão, a voz do Windows entra no lugar (mais robótica).
- O conteúdo é seu: revise roteiro e fatos antes de publicar.
