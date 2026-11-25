// API completa do AFS Bancada Inteligente na Netlify.
// O site chama POST /actions com { action, args } e espera { data } —
// a Netlify redireciona /actions para esta função (netlify.toml).
// Banco: Turso. IA: roda na função em segundo plano
// (analyze-background) e o resultado é lido pela ação getAiJob.

import {
  DIAGNOSIS_COLS,
  MISSING_AI_MSG,
  aiConfig,
  aiText,
  diagnosisToOut,
  ensureSchema,
  fail,
  iso,
  normalizeComponent,
  now,
  ok,
  q,
  run,
  tursoConfig,
} from "./lib/shared.mjs";

const s = (v, max) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const n = (v, min, max, dflt) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(x)));
};

// Arquivos de publicação gerados pela aba Publicar (deploy completo).
function deployKit() {
  const netlifyToml = [
    "# AFS Bancada Inteligente — deploy completo na Netlify",
    "[build]",
    '  publish = "client/dist"',
    "",
    "[functions]",
    '  directory = "netlify/functions"',
    "",
    "[[redirects]]",
    '  from = "/actions"',
    '  to = "/.netlify/functions/actions"',
    "  status = 200",
    "  force = true",
    "",
    "[[redirects]]",
    '  from = "/*"',
    '  to = "/index.html"',
    "  status = 200",
  ].join("\n");
  const redirects = [
    "/actions  /.netlify/functions/actions  200!",
    "/*  /index.html  200",
    "",
  ].join("\n");
  const envExample = [
    "# Variáveis do deploy completo (Netlify → Site settings → Environment variables)",
    "# Banco de dados Turso (crie grátis em turso.tech)",
    "TURSO_DATABASE_URL=libsql://SEU-BANCO.turso.io",
    "TURSO_AUTH_TOKEN=",
    "# IA da Meta (dev.meta.ai → API keys)",
    "AI_API_KEY=",
    "AI_API_BASE_URL=",
    "AI_MODEL=",
    "",
  ].join("\n");
  return { netlifyToml, redirects, envExample };
}

async function startAiJob(event, kind, args) {
  if (!aiConfig()) throw new Error(MISSING_AI_MSG);
  const inserted = await run(
    `INSERT INTO ai_jobs (kind, status, payload_json, created_at, updated_at)
     VALUES (?, 'pending', ?, ?, ?)`,
    [kind, JSON.stringify(args), now(), now()],
  );
  const jobId = inserted.lastInsertRowid;
  const host = event.headers?.host;
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  if (host) {
    // Dispara a função em segundo plano (responde 202 na hora).
    await fetch(`${proto}://${host}/.netlify/functions/analyze-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, kind, args }),
    }).catch(() => undefined);
  }
  return String(jobId);
}

const handlers = {
  // ---------------------------------------------------------- diagnóstico
  async analyzeDiagnosis(event, a) {
    const aparelho = s(a.aparelho, 120);
    const defeito = s(a.defeito, 2000);
    if (!aparelho) throw new Error("Informe o aparelho.");
    if (defeito.length < 3) throw new Error("Descreva o defeito.");
    const args = {
      aparelho,
      marca: s(a.marca, 80),
      modelo: s(a.modelo, 80),
      categoria: s(a.categoria, 60) || "Outro",
      defeito,
      image: a.image?.dataBase64 ? a.image : undefined,
      video: a.video?.dataBase64 ? a.video : undefined,
      videoFrames: Array.isArray(a.videoFrames)
        ? a.videoFrames.slice(0, 4)
        : undefined,
    };
    const jobId = await startAiJob(event, "diagnosis", args);
    return {
      pending: true,
      jobId,
      id: 0,
      aparelho,
      marca: args.marca,
      modelo: args.modelo,
      categoria: args.categoria,
      defeito,
      fotoUrl: null,
      videoUrl: null,
      analise: null,
      status: "aberto",
      solucao: null,
      created_at: new Date().toISOString(),
    };
  },

  async getAiJob(_event, a) {
    const jobId = Number(a.jobId);
    const rows = await q("SELECT * FROM ai_jobs WHERE id = ?", [jobId]);
    const job = rows[0];
    if (!job) {
      return {
        status: "error",
        diagnosis: null,
        component: null,
        error: "Análise não encontrada. Envie o diagnóstico de novo.",
      };
    }
    if (job.status === "pending") {
      return { status: "pending", diagnosis: null, component: null, error: null };
    }
    if (job.status === "error") {
      return {
        status: "error",
        diagnosis: null,
        component: null,
        error: job.error || "A análise falhou. Tente de novo.",
      };
    }
    if (job.kind === "diagnosis" && job.result_id) {
      const drows = await q(
        `SELECT ${DIAGNOSIS_COLS} FROM diagnoses WHERE id = ?`,
        [job.result_id],
      );
      return {
        status: "done",
        diagnosis: drows[0] ? diagnosisToOut(drows[0]) : null,
        component: null,
        error: drows[0] ? null : "Diagnóstico não encontrado.",
      };
    }
    return {
      status: "done",
      diagnosis: null,
      component: job.result_json
        ? normalizeComponent(JSON.parse(job.result_json))
        : null,
      error: null,
    };
  },

  async listDiagnoses(_event, a) {
    const limit = n(a.limit, 1, 100, 50);
    const rows = await q(
      `SELECT ${DIAGNOSIS_COLS} FROM diagnoses ORDER BY id DESC LIMIT ?`,
      [limit],
    );
    return { diagnoses: rows.map(diagnosisToOut) };
  },

  async updateDiagnosis(_event, a) {
    if (a.status !== undefined) {
      await run("UPDATE diagnoses SET status = ? WHERE id = ?", [
        a.status === "resolvido" ? "resolvido" : "aberto",
        Number(a.id),
      ]);
    }
    if (a.solucao !== undefined) {
      await run("UPDATE diagnoses SET solucao = ? WHERE id = ?", [
        s(a.solucao, 2000) || null,
        Number(a.id),
      ]);
    }
    return { ok: true };
  },

  async deleteDiagnosis(_event, a) {
    await run("DELETE FROM diagnoses WHERE id = ?", [Number(a.id)]);
    return { ok: true };
  },

  async saveDiagnosisToBank(_event, a) {
    const rows = await q("SELECT * FROM diagnoses WHERE id = ?", [
      Number(a.diagnosisId),
    ]);
    const diag = rows[0];
    if (!diag) throw new Error("Diagnóstico não encontrado.");
    const solucao = s(a.solucao, 2000);
    if (!solucao) throw new Error("Informe a solução aplicada.");
    const inserted = await run(
      `INSERT INTO defect_bank (aparelho, marca, modelo, defeito, causa, solucao, origem, diagnosis_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'diagnostico', ?, ?)`,
      [diag.aparelho, diag.marca, diag.modelo, diag.defeito, s(a.causa, 1000), solucao, diag.id, now()],
    );
    await run("UPDATE diagnoses SET status = 'resolvido', solucao = ? WHERE id = ?", [
      solucao,
      diag.id,
    ]);
    return { id: inserted.lastInsertRowid };
  },

  // ------------------------------------------------------------- defeitos
  async listDefects(_event, a) {
    const limit = n(a.limit, 1, 200, 100);
    const rows = await q(
      "SELECT * FROM defect_bank ORDER BY id DESC LIMIT ?",
      [limit],
    );
    return {
      defects: rows.map((r) => ({
        id: r.id,
        aparelho: r.aparelho,
        marca: r.marca,
        modelo: r.modelo,
        defeito: r.defeito,
        causa: r.causa,
        solucao: r.solucao,
        origem: r.origem,
        created_at: iso(r.created_at),
      })),
    };
  },

  async createDefect(_event, a) {
    const inserted = await run(
      `INSERT INTO defect_bank (aparelho, marca, modelo, defeito, causa, solucao, origem, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
      [
        s(a.aparelho, 120),
        s(a.marca, 80),
        s(a.modelo, 80),
        s(a.defeito, 1000),
        s(a.causa, 1000),
        s(a.solucao, 2000),
        now(),
      ],
    );
    return { id: inserted.lastInsertRowid };
  },

  async deleteDefect(_event, a) {
    await run("DELETE FROM defect_bank WHERE id = ?", [Number(a.id)]);
    return { ok: true };
  },

  // ---------------------------------------------------------- componentes
  async lookupComponent(event, a) {
    const codigo = s(a.codigo, 60);
    if (codigo.length < 2) throw new Error("Digite o código do componente.");
    const jobId = await startAiJob(event, "component", {
      codigo,
      comparar: s(a.comparar, 60),
    });
    return { pending: true, jobId };
  },

  // -------------------------------------------------------------- clientes
  async listClients() {
    const rows = await q("SELECT * FROM clients ORDER BY lower(nome)");
    return {
      clients: rows.map((r) => ({
        id: r.id,
        nome: r.nome,
        telefone: r.telefone,
        email: r.email,
        endereco: r.endereco,
        notas: r.notas,
        created_at: iso(r.created_at),
      })),
    };
  },

  async createClient(_event, a) {
    const inserted = await run(
      `INSERT INTO clients (nome, telefone, email, endereco, notas, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [s(a.nome, 120), s(a.telefone, 40), s(a.email, 120), s(a.endereco, 300), s(a.notas, 500), now()],
    );
    return { id: inserted.lastInsertRowid };
  },

  async updateClient(_event, a) {
    await run(
      "UPDATE clients SET nome = ?, telefone = ?, email = ?, endereco = ?, notas = ? WHERE id = ?",
      [s(a.nome, 120), s(a.telefone, 40), s(a.email, 120), s(a.endereco, 300), s(a.notas, 500), Number(a.id)],
    );
    return { ok: true };
  },

  async deleteClient(_event, a) {
    await run("DELETE FROM clients WHERE id = ?", [Number(a.id)]);
    return { ok: true };
  },

  // ----------------------------------------------------------- equipamentos
  async listEquipments() {
    const rows = await q("SELECT * FROM equipments ORDER BY id DESC");
    return {
      equipments: rows.map((r) => ({
        id: r.id,
        clientId: r.client_id ?? null,
        aparelho: r.aparelho,
        marca: r.marca,
        modelo: r.modelo,
        serial: r.serial,
        notas: r.notas,
      })),
    };
  },

  async createEquipment(_event, a) {
    const inserted = await run(
      `INSERT INTO equipments (client_id, aparelho, marca, modelo, serial, notas, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        a.clientId ? Number(a.clientId) : null,
        s(a.aparelho, 120),
        s(a.marca, 80),
        s(a.modelo, 80),
        s(a.serial, 80),
        s(a.notas, 500),
        now(),
      ],
    );
    return { id: inserted.lastInsertRowid };
  },

  async deleteEquipment(_event, a) {
    await run("DELETE FROM equipments WHERE id = ?", [Number(a.id)]);
    return { ok: true };
  },

  // ------------------------------------------------------------------- OS
  async listOrders(_event, a) {
    const limit = n(a.limit, 1, 200, 100);
    const rows = await q(
      "SELECT * FROM service_orders ORDER BY id DESC LIMIT ?",
      [limit],
    );
    return {
      orders: rows.map((r) => ({
        id: r.id,
        numero: r.numero,
        clientId: r.client_id ?? null,
        clientName: r.client_name,
        equipmentDesc: r.equipment_desc,
        defeito: r.defeito,
        status: r.status,
        valorCents: r.valor_cents,
        laudo: r.laudo,
        garantiaDias: r.garantia_dias,
        created_at: iso(r.created_at),
        updated_at: iso(r.updated_at),
      })),
    };
  },

  async createOrder(_event, a) {
    const t = now();
    const inserted = await run(
      `INSERT INTO service_orders (client_id, client_name, equipment_desc, defeito, status, valor_cents, garantia_dias, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'aberta', ?, ?, ?, ?)`,
      [
        a.clientId ? Number(a.clientId) : null,
        s(a.clientName, 120),
        s(a.equipmentDesc, 200),
        s(a.defeito, 1000),
        n(a.valorCents, 0, 100_000_000, 0),
        n(a.garantiaDias, 0, 3650, 90),
        t,
        t,
      ],
    );
    const numero = `OS-${String(inserted.lastInsertRowid).padStart(4, "0")}`;
    await run("UPDATE service_orders SET numero = ? WHERE id = ?", [
      numero,
      inserted.lastInsertRowid,
    ]);
    return { id: inserted.lastInsertRowid, numero };
  },

  async updateOrder(_event, a) {
    const sets = ["updated_at = ?"];
    const vals = [now()];
    const allowed = {
      status: (v) => s(v, 30),
      valorCents: (v) => n(v, 0, 100_000_000, 0),
      laudo: (v) => s(v, 2000),
      garantiaDias: (v) => n(v, 0, 3650, 90),
      defeito: (v) => s(v, 1000),
      equipmentDesc: (v) => s(v, 200),
      clientName: (v) => s(v, 120),
    };
    const cols = {
      status: "status",
      valorCents: "valor_cents",
      laudo: "laudo",
      garantiaDias: "garantia_dias",
      defeito: "defeito",
      equipmentDesc: "equipment_desc",
      clientName: "client_name",
    };
    for (const key of Object.keys(allowed)) {
      if (a[key] !== undefined) {
        sets.push(`${cols[key]} = ?`);
        vals.push(allowed[key](a[key]));
      }
    }
    vals.push(Number(a.id));
    await run(`UPDATE service_orders SET ${sets.join(", ")} WHERE id = ?`, vals);
    return { ok: true };
  },

  async deleteOrder(_event, a) {
    await run("DELETE FROM service_orders WHERE id = ?", [Number(a.id)]);
    return { ok: true };
  },

  // --------------------------------------------------------------- estoque
  async listStock() {
    const rows = await q("SELECT * FROM stock_items ORDER BY lower(nome)");
    return {
      items: rows.map((r) => ({
        id: r.id,
        nome: r.nome,
        codigo: r.codigo,
        quantidade: r.quantidade,
        minimo: r.minimo,
        precoCents: r.preco_cents,
        localizacao: r.localizacao,
      })),
    };
  },

  async createStockItem(_event, a) {
    const inserted = await run(
      `INSERT INTO stock_items (nome, codigo, quantidade, minimo, preco_cents, localizacao, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        s(a.nome, 120),
        s(a.codigo, 60),
        n(a.quantidade, 0, 1_000_000, 0),
        n(a.minimo, 0, 100_000, 1),
        n(a.precoCents, 0, 100_000_000, 0),
        s(a.localizacao, 80),
        now(),
      ],
    );
    return { id: inserted.lastInsertRowid };
  },

  async updateStockItem(_event, a) {
    await run(
      `UPDATE stock_items SET nome = ?, codigo = ?, quantidade = ?, minimo = ?, preco_cents = ?, localizacao = ? WHERE id = ?`,
      [
        s(a.nome, 120),
        s(a.codigo, 60),
        n(a.quantidade, 0, 1_000_000, 0),
        n(a.minimo, 0, 100_000, 1),
        n(a.precoCents, 0, 100_000_000, 0),
        s(a.localizacao, 80),
        Number(a.id),
      ],
    );
    return { ok: true };
  },

  async adjustStock(_event, a) {
    await run(
      "UPDATE stock_items SET quantidade = max(0, quantidade + ?) WHERE id = ?",
      [n(a.delta, -100000, 100000, 0), Number(a.id)],
    );
    return { ok: true };
  },

  async deleteStockItem(_event, a) {
    await run("DELETE FROM stock_items WHERE id = ?", [Number(a.id)]);
    return { ok: true };
  },

  // --------------------------------------------------------------- empresa
  async getSettings() {
    const rows = await q("SELECT key, value, (blob IS NOT NULL) AS has_blob FROM settings");
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const logo = rows.find((r) => r.key === "__logo");
    return {
      businessName: map.get("businessName") || "",
      businessLegalName: map.get("businessLegalName") || "",
      businessDocument: map.get("businessDocument") || "",
      businessStateReg: map.get("businessStateReg") || "",
      businessResponsible: map.get("businessResponsible") || "",
      businessPhone: map.get("businessPhone") || "",
      businessEmail: map.get("businessEmail") || "",
      businessWebsite: map.get("businessWebsite") || "",
      businessAddress: map.get("businessAddress") || "",
      businessCity: map.get("businessCity") || "",
      businessZip: map.get("businessZip") || "",
      logoUrl: logo?.has_blob ? "/.netlify/functions/media?kind=logo" : null,
    };
  },

  async updateSettings(_event, a) {
    const entries = [
      ["businessName", 120], ["businessLegalName", 160], ["businessDocument", 30],
      ["businessStateReg", 30], ["businessResponsible", 120], ["businessPhone", 40],
      ["businessEmail", 120], ["businessWebsite", 160], ["businessAddress", 300],
      ["businessCity", 120], ["businessZip", 12],
    ];
    for (const [key, max] of entries) {
      await run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, s(a[key], max)],
      );
    }
    return { ok: true };
  },

  async uploadLogo(_event, a) {
    if (!a.image?.dataBase64) throw new Error("Imagem da logomarca não enviada.");
    await run(
      `INSERT INTO settings (key, value, blob, mime) VALUES ('__logo', '', ?, ?)
       ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, mime = excluded.mime`,
      [Buffer.from(a.image.dataBase64, "base64"), s(a.image.mimeType, 60)],
    );
    return { logoUrl: "/.netlify/functions/media?kind=logo" };
  },

  async removeLogo() {
    await run("DELETE FROM settings WHERE key = '__logo'");
    return { ok: true };
  },

  // ------------------------------------------------------------- publicar
  async getDeployInfo() {
    const kit = deployKit();
    return {
      mode: "netlify-completo",
      aiProvider: "API da Meta (dev.meta.ai) via funções da Netlify",
      aiConnected: !!aiConfig(),
      dbConnected: !!tursoConfig(),
      hostingTarget: "Netlify (site + funções + banco externo)",
      publishDir: "client/dist",
      functionsDir: "netlify/functions",
      netlifyToml: kit.netlifyToml,
      envExample: kit.envExample,
      steps: [
        "Crie o banco grátis no Turso (turso.tech) e copie a URL e o token do banco.",
        "Crie a chave da IA no painel da Meta (dev.meta.ai) e anote a URL base e o modelo indicados lá.",
        "Suba este projeto para a Netlify (importando do GitHub ou com a Netlify CLI) — o netlify.toml já aponta o site e as funções.",
        "Na Netlify, em Site settings → Environment variables, cadastre TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, AI_API_KEY, AI_API_BASE_URL e AI_MODEL, e faça um novo deploy.",
        "Abra a URL da Netlify e faça um diagnóstico com foto: a análise roda na função em segundo plano e o resultado aparece na tela.",
      ],
    };
  },

  async getFullDeployKit() {
    const kit = deployKit();
    return { ...kit, bridgeUrl: "/actions → /.netlify/functions/actions (na própria Netlify)" };
  },

  async getEasyDeployGuide() {
    return {
      readyItems: [
        { label: "Site compilado e pronto (pasta client/dist)", ok: true },
        { label: "Funções da API prontas: diagnóstico, gestão, fotos e logomarca", ok: true },
        { label: "Análise da IA em segundo plano, sem erro de tempo limite", ok: true },
        { label: "Banco cria as tabelas sozinho no primeiro uso", ok: true },
        { label: "netlify.toml e _redirects já configurados", ok: true },
        { label: "Roteiro de publicação incluído no pacote", ok: true },
      ],
      userSteps: [
        "Entrar com seu login e senha quando a tela pedir (Netlify, GitHub, Turso e Meta) — a senha é pessoal e ninguém digita por você.",
        "Tocar em autorizar ou confirmar nas telas que ligam uma conta na outra.",
        "Avisar no chat quando terminar de logar, para a publicação continuar de onde parou.",
      ],
      roteiro:
        "Este app já está publicado. O roteiro completo de publicação (COMO-PUBLICAR.txt) acompanha o pacote do projeto.",
    };
  },

  async pingAi() {
    const resposta = await aiText(
      "Você é a IA de diagnóstico do AFS Bancada Inteligente.",
      "Responda apenas com a palavra PRONTA.",
    );
    return { ok: true, resposta: String(resposta).slice(0, 120) };
  },

  // ------------------------------------------------------------- dashboard
  async getDashboard() {
    const one = async (sql) => (await q(sql))[0]?.n ?? 0;
    const totalDiagnoses = await one("SELECT count(*) AS n FROM diagnoses");
    const openDiagnoses = await one(
      "SELECT count(*) AS n FROM diagnoses WHERE status = 'aberto'",
    );
    const totalDefects = await one("SELECT count(*) AS n FROM defect_bank");
    const totalClients = await one("SELECT count(*) AS n FROM clients");
    const orders = await q("SELECT status, valor_cents FROM service_orders");
    const openOrders = orders.filter(
      (o) => !["concluida", "entregue", "cancelada"].includes(o.status),
    ).length;
    const revenueCents = orders
      .filter((o) => o.status === "concluida" || o.status === "entregue")
      .reduce((sum, o) => sum + o.valor_cents, 0);
    const lowStock = await one(
      "SELECT count(*) AS n FROM stock_items WHERE quantidade <= minimo",
    );
    return {
      totalDiagnoses,
      openDiagnoses,
      totalDefects,
      openOrders,
      totalClients,
      lowStock,
      revenueCents,
    };
  },
};

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return fail("Método não suportado.", 405);
    const body = JSON.parse(event.body || "{}");
    const name = body.action;
    const args = body.args || {};
    const fn = handlers[name];
    if (!fn) return fail(`Ação desconhecida: ${name}`, 404);
    // pingAi e as ações de publicação não precisam de banco.
    if (name !== "pingAi" && name !== "getDeployInfo" && name !== "getFullDeployKit" && name !== "getEasyDeployGuide") {
      if (!tursoConfig()) {
        return fail(
          "Banco de dados não configurado: defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN nas variáveis de ambiente da Netlify e faça um novo deploy.",
          500,
        );
      }
      await ensureSchema();
    }
    return ok(await fn(event, args));
  } catch (e) {
    return fail(e?.message || "Erro inesperado.", 500);
  }
};
