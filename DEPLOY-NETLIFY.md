# Publicar o AFS Bancada Inteligente na Netlify — modo fácil

**Você não precisa fazer os passos técnicos.** O projeto está 100% pronto
e a publicação é feita pela Muse, pelo navegador, configurando cada
serviço. A sua parte é só **entrar com login e senha** quando a tela
pedir — Netlify, GitHub, Turso e Meta — e tocar em autorizar quando
aparecer. Senha é pessoal: ninguém digita por você.

Para começar, diga no chat: **“pode publicar”**.

O roteiro técnico completo que a Muse segue está em
**`COMO-PUBLICAR.txt`** (neste pacote e para baixar na aba Publicar do
app). O resumo dele está abaixo, para conferência ou suporte.

## Como fica

| Parte | Onde roda | O quê |
|---|---|---|
| Site (interface) | Netlify | arquivos de `client/dist` (já compilados, com `_redirects`) |
| API do app (`/actions`) | Netlify Functions | `netlify/functions/actions.mjs` |
| Análise da IA | Netlify Background Function | `netlify/functions/analyze-background.mjs` (até 15 min, sem erro de tempo limite) |
| Fotos, vídeos e logomarca | Netlify Functions | `netlify/functions/media.mjs` |
| Banco de dados | **Turso** (grátis) | clientes, OS, estoque, diagnósticos, fotos — tabelas criadas sozinhas no primeiro uso |
| Inteligência artificial | **API da Meta** (dev.meta.ai) | análise das fotos e datasheets |

## Resumo do roteiro (detalhes no COMO-PUBLICAR.txt)

1. **Turso** — criar o banco e copiar a Database URL e o token.
2. **Meta (dev.meta.ai)** — criar a API key e copiar a URL base e o
   modelo indicados no quickstart do painel (nunca inventar esses dois
   valores).
3. **GitHub** — criar repositório privado e subir o projeto pelo
   navegador (“uploading an existing file”, arrastando as pastas).
4. **Netlify** — Add new site → Import an existing project → escolher o
   repositório → Deploy site (o `netlify.toml` já configura tudo).
5. **Variáveis** — Site settings → Environment variables: cadastrar
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AI_API_KEY`,
   `AI_API_BASE_URL` e `AI_MODEL`; depois Deploys → Trigger deploy.
6. **Teste** — abrir a URL da Netlify, fazer um diagnóstico com foto e
   cadastrar um cliente/OS para conferir o banco.

> Arrastar a pasta em app.netlify.com/drop **não serve** nesta versão:
> publica só os arquivos estáticos e as funções (IA e banco) não sobem.

## Limites honestos desta versão

- **Sem login**: quem tiver a URL usa o app e gasta a sua cota da IA.
  Não divulgue a URL publicamente.
- **Dados não migram**: o histórico do app no Muse não vai sozinho
  para o Turso — o app da Netlify começa vazio.
- **Vídeos curtos**: prefira até ~4 MB; a análise usa os quadros.
- **Cobrança à parte**: o app não cobra os R$ 80 dos compradores — o
  pagamento continua por fora, como você já faz.

## Problemas comuns

- **“Banco de dados não configurado”** → variável do Turso faltando ou
  deploy não refeito depois de cadastrá-la.
- **“IA não configurada”** → idem para as variáveis da Meta.
- **Erro 401/403 da IA** → chave inválida ou modelo sem acesso.
- **Site abre mas nada salva** → a pasta `netlify/functions` não subiu
  (deploy via Drop não serve — use GitHub ou CLI).
