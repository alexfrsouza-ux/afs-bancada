// Entrega fotos, vídeos e a logomarca guardados como blob no banco
// (Turso). Uso: /.netlify/functions/media?kind=foto|video|logo&id=<id>
// (logo não precisa de id). O site usa essas URLs em <img> e <video>.

import { ensureSchema, q } from "./lib/shared.mjs";

export const handler = async (event) => {
  try {
    const kind = event.queryStringParameters?.kind || "";
    const id = Number(event.queryStringParameters?.id || 0);
    const valid =
      kind === "logo" || ((kind === "foto" || kind === "video") && id > 0);
    if (!valid) return { statusCode: 400, body: "parâmetros inválidos" };
    await ensureSchema();

    let rows = [];
    if (kind === "foto" && id > 0) {
      rows = await q(
        "SELECT foto_blob AS blob, foto_mime AS mime FROM diagnoses WHERE id = ?",
        [id],
      );
    } else if (kind === "video" && id > 0) {
      rows = await q(
        "SELECT video_blob AS blob, video_mime AS mime FROM diagnoses WHERE id = ?",
        [id],
      );
    } else if (kind === "logo") {
      rows = await q(
        "SELECT blob, mime FROM settings WHERE key = '__logo'",
        [],
      );
    }

    const row = rows[0];
    if (!row || !row.blob) return { statusCode: 404, body: "não encontrado" };
    return {
      statusCode: 200,
      headers: {
        "content-type": row.mime || "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
      body: row.blob, // base64 vindo do Turso
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: String(e?.message || e) };
  }
};
