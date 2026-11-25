-- AFS Bancada Inteligente — estrutura do banco Turso (referência).
-- Você NÃO precisa rodar este arquivo: as funções da Netlify criam as
-- tabelas sozinhas no primeiro uso (CREATE TABLE IF NOT EXISTS).
-- Ele fica aqui só para conferência/migração manual.

CREATE TABLE IF NOT EXISTS diagnoses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aparelho TEXT NOT NULL, marca TEXT NOT NULL DEFAULT '',
  modelo TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT 'Outro',
  defeito TEXT NOT NULL,
  foto_blob BLOB, foto_mime TEXT, video_blob BLOB, video_mime TEXT,
  analise_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'aberto',
  solucao TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS defect_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aparelho TEXT NOT NULL, marca TEXT NOT NULL DEFAULT '',
  modelo TEXT NOT NULL DEFAULT '', defeito TEXT NOT NULL,
  causa TEXT NOT NULL DEFAULT '', solucao TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'manual', diagnosis_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL, telefone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', endereco TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS equipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER, aparelho TEXT NOT NULL,
  marca TEXT NOT NULL DEFAULT '', modelo TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '', notas TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS service_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL DEFAULT '', client_id INTEGER,
  client_name TEXT NOT NULL DEFAULT '', equipment_desc TEXT NOT NULL DEFAULT '',
  defeito TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'aberta',
  valor_cents INTEGER NOT NULL DEFAULT 0, laudo TEXT NOT NULL DEFAULT '',
  garantia_dias INTEGER NOT NULL DEFAULT 90,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL, codigo TEXT NOT NULL DEFAULT '',
  quantidade INTEGER NOT NULL DEFAULT 0, minimo INTEGER NOT NULL DEFAULT 1,
  preco_cents INTEGER NOT NULL DEFAULT 0, localizacao TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '',
  blob BLOB, mime TEXT
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT, result_id INTEGER, result_json TEXT,
  error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
