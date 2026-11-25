// AFS Bancada Inteligente — deploy completo na Netlify.
// Biblioteca compartilhada das funções (não é um endpoint).
//
// Arquitetura standalone (sem depender do Muse):
//  - Site estático ......... client/dist (publicado pela Netlify)
//  - API (/actions) ........ netlify/functions/actions.mjs
//  - IA em segundo plano ... netlify/functions/analyze-background.mjs
//    (a análise leva dezenas de segundos; função comum da Netlify tem
//    limite curto, por isso a IA roda como background function e o
//    site consulta o resultado pela ação getAiJob)
//  - Fotos/vídeo/logo ...... netlify/functions/media.mjs (lê os blobs)
//  - Banco de dados ........ Turso (libSQL) via API HTTP — variáveis
//    TURSO_DATABASE_URL e TURSO_AUTH_TOKEN
//  - Inteligência artificial API de modelos da Meta (dev.meta.ai),
//    compatível com o formato OpenAI de chat completions — variáveis
//    AI_API_KEY, AI_API_BASE_URL e AI_MODEL

// ------------------------------------------------------------ respostas

export function ok(data) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data }),
  };
}

export function fail(message, status = 400) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: String(message) }),
  };
}

// ------------------------------------------------------------ config

export function tursoConfig() {
  const url = (process.env.TURSO_DATABASE_URL || "").trim();
  const token = (process.env.TURSO_AUTH_TOKEN || "").trim();
  if (!url || !token) return null;
  return {
    url: url.replace(/^libsql:\/\//, "https://").replace(/\/+$/, ""),
    token,
  };
}

export function aiConfig() {
  const key = (process.env.AI_API_KEY || "").trim();
  const base = (process.env.AI_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const model = (process.env.AI_MODEL || "").trim();
  if (!key || !base || !model) return null;
  return { key, base, model };
}

export const MISSING_DB_MSG =
  "Banco de dados não configurado: defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN nas variáveis de ambiente da Netlify (Site settings → Environment variables) e faça um novo deploy.";
export const MISSING_AI_MSG =
  "IA não configurada: defina AI_API_KEY, AI_API_BASE_URL e AI_MODEL nas variáveis de ambiente da Netlify (a chave e os dados de conexão saem do painel da Meta em dev.meta.ai) e faça um novo deploy.";

// ------------------------------------------------------------ Turso

function toArg(v) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { type: "integer", value: String(v) }
      : { type: "float", value: v };
  }
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  if (v instanceof Uint8Array) {
    return { type: "blob", base64: Buffer.from(v).toString("base64") };
  }
  return { type: "text", value: String(v) };
}

function fromCell(c) {
  if (!c || c.type === "null") return null;
  if (c.type === "integer") return Number(c.value);
  if (c.type === "float") return Number(c.value);
  if (c.type === "blob") return c.base64 || "";
  return c.value;
}

async function pipeline(statements) {
  const cfg = tursoConfig();
  if (!cfg) throw new Error(MISSING_DB_MSG);
  const res = await fetch(`${cfg.url}/v2/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        ...statements.map((s) => ({
          type: "execute",
          stmt: { sql: s.sql, args: (s.args || []).map(toArg) },
        })),
        { type: "close" },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Banco de dados respondeu HTTP ${res.status}. Confira TURSO_DATABASE_URL e TURSO_AUTH_TOKEN.`);
  }
  const body = await res.json();
  const out = [];
  for (const r of body.results || []) {
    if (r.type === "error") {
      throw new Error(`Erro no banco de dados: ${r.error?.message || "desconhecido"}`);
    }
    const result = r.response?.result;
    if (!result) {
      out.push({ rows: [], lastInsertRowid: null });
      continue;
    }
    const cols = (result.cols || []).map((c) => c.name);
    const rows = (result.rows || []).map((row) => {
      const obj = {};
      cols.forEach((name, i) => {
        obj[name] = fromCell(row[i]);
      });
      return obj;
    });
    out.push({
      rows,
      lastInsertRowid:
        result.last_insert_rowid != null ? Number(result.last_insert_rowid) : null,
    });
  }
  return out;
}

export async function q(sql, args = []) {
  const [r] = await pipeline([{ sql, args }]);
  return r.rows;
}

export async function run(sql, args = []) {
  const [r] = await pipeline([{ sql, args }]);
  return r;
}

// Cria as tabelas (mesma estrutura do app no Muse) na primeira chamada.
let schemaPromise = null;
export function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const stmts = [
        `CREATE TABLE IF NOT EXISTS diagnoses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          aparelho TEXT NOT NULL, marca TEXT NOT NULL DEFAULT '',
          modelo TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT 'Outro',
          defeito TEXT NOT NULL,
          foto_blob BLOB, foto_mime TEXT, video_blob BLOB, video_mime TEXT,
          analise_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'aberto',
          solucao TEXT, created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS defect_bank (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          aparelho TEXT NOT NULL, marca TEXT NOT NULL DEFAULT '',
          modelo TEXT NOT NULL DEFAULT '', defeito TEXT NOT NULL,
          causa TEXT NOT NULL DEFAULT '', solucao TEXT NOT NULL,
          origem TEXT NOT NULL DEFAULT 'manual', diagnosis_id INTEGER,
          created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL, telefone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '', endereco TEXT NOT NULL DEFAULT '',
          notas TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS equipments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER, aparelho TEXT NOT NULL,
          marca TEXT NOT NULL DEFAULT '', modelo TEXT NOT NULL DEFAULT '',
          serial TEXT NOT NULL DEFAULT '', notas TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS service_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          numero TEXT NOT NULL DEFAULT '', client_id INTEGER,
          client_name TEXT NOT NULL DEFAULT '', equipment_desc TEXT NOT NULL DEFAULT '',
          defeito TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'aberta',
          valor_cents INTEGER NOT NULL DEFAULT 0, laudo TEXT NOT NULL DEFAULT '',
          garantia_dias INTEGER NOT NULL DEFAULT 90,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS stock_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL, codigo TEXT NOT NULL DEFAULT '',
          quantidade INTEGER NOT NULL DEFAULT 0, minimo INTEGER NOT NULL DEFAULT 1,
          preco_cents INTEGER NOT NULL DEFAULT 0, localizacao TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '',
          blob BLOB, mime TEXT)`,
        `CREATE TABLE IF NOT EXISTS ai_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
          payload_json TEXT, result_id INTEGER, result_json TEXT,
          error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      ];
      await pipeline(stmts.map((sql) => ({ sql, args: [] })));
    })().catch((e) => {
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}

// ------------------------------------------------------------ IA (Meta)

async function aiFetch(path, payload) {
  const cfg = aiConfig();
  if (!cfg) throw new Error(MISSING_AI_MSG);
  const res = await fetch(`${cfg.base}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`A IA respondeu HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("A IA respondeu em um formato inesperado. Tente de novo.");
  }
}

function extractContent(body) {
  const msg = body?.choices?.[0]?.message;
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("");
  }
  if (typeof body?.output_text === "string") return body.output_text;
  return "";
}

export async function aiText(system, userText) {
  const cfg = aiConfig();
  if (!cfg) throw new Error(MISSING_AI_MSG);
  const body = await aiFetch("/chat/completions", {
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
    temperature: 0.3,
  });
  return extractContent(body);
}

export async function aiJson(system, userText, images = []) {
  const cfg = aiConfig();
  if (!cfg) throw new Error(MISSING_AI_MSG);
  const content = [{ type: "text", text: userText }];
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` },
    });
  }
  const payload = {
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  };
  let body;
  try {
    body = await aiFetch("/chat/completions", payload);
  } catch (e) {
    // Alguns modelos/planos recusam response_format: tenta sem ele.
    if (String(e.message || "").includes("response_format") || String(e.message || "").includes("HTTP 400")) {
      const { response_format, ...rest } = payload;
      body = await aiFetch("/chat/completions", rest);
    } else {
      throw e;
    }
  }
  const raw = extractContent(body);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("A IA não devolveu um relatório válido. Tente de novo.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("A IA devolveu um relatório que não pôde ser lido. Tente de novo.");
  }
}

// ------------------------------------------------- normalização da IA

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const strArr = (v) =>
  Array.isArray(v) ? v.map((x) => str(x)).filter((x) => x.length > 0) : [];

export function normalizeAnalysis(a) {
  const obj = a && typeof a === "object" ? a : {};
  return {
    resumo: str(obj.resumo),
    nivelDificuldade: str(obj.nivelDificuldade) || "—",
    tempoEstimado: str(obj.tempoEstimado) || "—",
    causas: (Array.isArray(obj.causas) ? obj.causas : []).map((c) => ({
      titulo: str(c?.titulo),
      probabilidade: str(c?.probabilidade) || "—",
      explicacao: str(c?.explicacao),
    })),
    testes: (Array.isArray(obj.testes) ? obj.testes : []).map((t) => ({
      passo: str(t?.passo),
      ferramenta: str(t?.ferramenta),
      valorEsperado: str(t?.valorEsperado),
      interpretacao: str(t?.interpretacao),
    })),
    componentesSuspeitos: strArr(obj.componentesSuspeitos),
    ferramentas: strArr(obj.ferramentas),
    avisosSeguranca: strArr(obj.avisosSeguranca),
    proximosPassos: strArr(obj.proximosPassos),
  };
}

export function normalizeComponent(c) {
  const obj = c && typeof c === "object" ? c : {};
  return {
    nome: str(obj.nome),
    descricao: str(obj.descricao),
    pinagem: (Array.isArray(obj.pinagem) ? obj.pinagem : []).map((p) => ({
      pino: str(p?.pino),
      funcao: str(p?.funcao),
    })),
    specs: (Array.isArray(obj.specs) ? obj.specs : []).map((s) => ({
      parametro: str(s?.parametro),
      valor: str(s?.valor),
    })),
    aplicacoes: strArr(obj.aplicacoes),
    testes: strArr(obj.testes),
    substitutos: (Array.isArray(obj.substitutos) ? obj.substitutos : []).map(
      (s) => ({ codigo: str(s?.codigo), observacao: str(s?.observacao) }),
    ),
    comparacao: str(obj.comparacao),
    cuidados: strArr(obj.cuidados),
  };
}

// ------------------------------------------------------------ diversos

export const iso = (ms) => new Date(Number(ms)).toISOString();
export const now = () => Date.now();

export function diagnosisToOut(r) {
  let analise = null;
  try {
    analise = normalizeAnalysis(JSON.parse(r.analise_json));
  } catch {
    analise = null;
  }
  return {
    id: r.id,
    aparelho: r.aparelho,
    marca: r.marca,
    modelo: r.modelo,
    categoria: r.categoria,
    defeito: r.defeito,
    fotoUrl: r.has_foto
      ? `/.netlify/functions/media?kind=foto&id=${r.id}`
      : null,
    videoUrl: r.has_video
      ? `/.netlify/functions/media?kind=video&id=${r.id}`
      : null,
    analise,
    status: r.status,
    solucao: r.solucao ?? null,
    created_at: iso(r.created_at),
  };
}

export const DIAGNOSIS_COLS =
  "id, aparelho, marca, modelo, categoria, defeito, analise_json, status, solucao, created_at, (foto_blob IS NOT NULL) AS has_foto, (video_blob IS NOT NULL) AS has_video";
