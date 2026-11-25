// Função em segundo plano (background function da Netlify, até 15 min):
// roda a análise da IA fora do limite curto das funções comuns.
// Recebe { jobId, kind, args } da função actions, grava o resultado no
// banco (Turso) e marca o job como concluído; o site lê pela ação
// getAiJob até o status virar "done".

import {
  aiJson,
  ensureSchema,
  normalizeAnalysis,
  normalizeComponent,
  now,
  q,
  run,
} from "./lib/shared.mjs";

const ANALYSIS_KEYS = [
  "Responda SOMENTE com um objeto JSON válido, sem markdown e sem texto fora do JSON, com exatamente estas chaves:",
  '"resumo" (texto), "nivelDificuldade" (texto), "tempoEstimado" (texto),',
  '"causas": [{"titulo","probabilidade","explicacao"}],',
  '"testes": [{"passo","ferramenta","valorEsperado","interpretacao"}],',
  '"componentesSuspeitos": [textos], "ferramentas": [textos],',
  '"avisosSeguranca": [textos], "proximosPassos": [textos].',
].join("\n");

const COMPONENT_KEYS = [
  "Responda SOMENTE com um objeto JSON válido, sem markdown e sem texto fora do JSON, com exatamente estas chaves:",
  '"nome" (texto), "descricao" (texto),',
  '"pinagem": [{"pino","funcao"}], "specs": [{"parametro","valor"}],',
  '"aplicacoes": [textos], "testes": [textos],',
  '"substitutos": [{"codigo","observacao"}],',
  '"comparacao" (texto; vazio quando não houver segundo componente),',
  '"cuidados": [textos].',
].join("\n");

const DIAG_SYSTEM =
  "Você é o motor de diagnóstico do AFS Bancada Inteligente, um especialista sênior em reparo de placas eletrônicas e refrigeração que apoia técnicos de bancada no Brasil. Responda sempre em português brasileiro, com linguagem prática de oficina: causas prováveis priorizadas, testes passo a passo com valores esperados, componentes suspeitos e segurança. Nunca invente um código de erro ou especificação de modelo que não seja amplamente conhecido; quando algo depender do esquema elétrico, diga isso no passo correspondente.";

const COMP_SYSTEM =
  "Você é o consultor de datasheets do AFS Bancada Inteligente. Responda em português brasileiro, com dados de datasheet amplamente conhecidos e linguagem de bancada. Se um parâmetro variar entre fabricantes, indique a faixa típica e avise para confirmar no datasheet do fabricante específico. Nunca invente pinagem: se o código for ambíguo ou desconhecido, descreva a família mais comum e deixe isso claro na descrição.";

async function doDiagnosis(args) {
  const prompt = [
    `Aparelho: ${args.aparelho}`,
    args.marca ? `Marca: ${args.marca}` : null,
    args.modelo ? `Modelo: ${args.modelo}` : null,
    `Categoria: ${args.categoria}`,
    `Defeito relatado pelo técnico: ${args.defeito}`,
    args.image
      ? "Uma foto da placa acompanha este diagnóstico: examine a imagem em busca de componentes queimados, estufados, oxidados, trilhas rompidas, solda fria e códigos de componentes visíveis, e incorpore o que encontrar nas causas e nos testes."
      : null,
    args.videoFrames && args.videoFrames.length > 0
      ? `O técnico filmou a placa: ${args.videoFrames.length} quadro(s) extraídos do vídeo acompanham este diagnóstico. Examine os quadros como imagens da placa (componentes queimados, estufados, oxidados, trilhas rompidas, solda fria, códigos visíveis) e incorpore o que encontrar nas causas e nos testes.`
      : null,
    !args.image && !(args.videoFrames && args.videoFrames.length > 0)
      ? "Nenhuma foto nem vídeo foi enviado: baseie a análise no aparelho, modelo e sintoma relatado."
      : null,
    "Monte um roteiro de bancada prático e ordenado: comece pelos testes mais simples e prováveis, informe valores esperados de medição com multímetro/osciloscópio quando aplicável, e inclua avisos de segurança reais para esta categoria de equipamento (descarga de capacitores, rede AC, alta tensão, ESD).",
    ANALYSIS_KEYS,
  ]
    .filter(Boolean)
    .join("\n");

  const images = [];
  if (
    args.image &&
    (args.image.mimeType === "image/jpeg" || args.image.mimeType === "image/png")
  ) {
    images.push(args.image);
  }
  for (const frame of args.videoFrames ?? []) {
    if (frame.mimeType === "image/jpeg" || frame.mimeType === "image/png") {
      images.push(frame);
    }
  }

  const analise = normalizeAnalysis(
    await aiJson(DIAG_SYSTEM, prompt, images),
  );

  const fotoBytes = args.image
    ? Buffer.from(args.image.dataBase64, "base64")
    : null;
  const videoBytes = args.video
    ? Buffer.from(args.video.dataBase64, "base64")
    : null;

  const inserted = await run(
    `INSERT INTO diagnoses (aparelho, marca, modelo, categoria, defeito,
       foto_blob, foto_mime, video_blob, video_mime, analise_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.aparelho,
      args.marca || "",
      args.modelo || "",
      args.categoria,
      args.defeito,
      fotoBytes,
      args.image?.mimeType ?? null,
      videoBytes,
      args.video?.mimeType ?? null,
      JSON.stringify(analise),
      now(),
    ],
  );
  return { resultId: inserted.lastInsertRowid, resultJson: null };
}

async function doComponent(args) {
  const prompt = (
    args.comparar
      ? `Componente principal: ${args.codigo}\nSegundo componente para comparação: ${args.comparar}\nMonte a ficha do componente principal (pinagem, parâmetros-chave do datasheet, aplicações típicas em placas de eletrônica/refrigeração, como testar na bancada e substitutos diretos) e, no campo de comparação, compare os dois códigos de forma direta: diferenças de pinagem, tensão, corrente e se um pode substituir o outro e em que condições.`
      : `Componente: ${args.codigo}\nMonte a ficha de bancada deste componente: o que ele é, pinagem, parâmetros-chave do datasheet, aplicações típicas em placas de eletrônica/refrigeração, como testar com multímetro/osciloscópio, substitutos diretos ou equivalentes e cuidados no reparo. No campo de comparação, deixe uma string vazia.`
  ) + "\n" + COMPONENT_KEYS;
  const info = normalizeComponent(await aiJson(COMP_SYSTEM, prompt, []));
  return { resultId: null, resultJson: JSON.stringify(info) };
}

export const handler = async (event) => {
  let jobId = null;
  try {
    const body = JSON.parse(event.body || "{}");
    jobId = body.jobId;
    const { kind, args } = body;
    if (!jobId || !kind || !args) {
      return { statusCode: 400, body: "job inválido" };
    }
    await ensureSchema();
    const done =
      kind === "diagnosis"
        ? await doDiagnosis(args)
        : await doComponent(args);
    await run(
      `UPDATE ai_jobs SET status = 'done', result_id = ?, result_json = ?, updated_at = ? WHERE id = ?`,
      [done.resultId, done.resultJson, now(), jobId],
    );
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    if (jobId) {
      try {
        await run(
          `UPDATE ai_jobs SET status = 'error', error = ?, updated_at = ? WHERE id = ?`,
          [String(e?.message || e).slice(0, 500), now(), jobId],
        );
      } catch {
        /* sem banco acessível: nada a registrar */
      }
    }
    return { statusCode: 500, body: String(e?.message || e) };
  }
};
