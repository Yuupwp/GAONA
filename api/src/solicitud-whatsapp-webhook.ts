import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { firmaWhatsappValida, type crearServicioWhatsapp, type EventoWhatsapp } from "./solicitud-whatsapp";

const estadoSchema = z.object({
  id: z.string().regex(/^wamid\.[\w+/=.-]{1,500}$/),
  recipient_id: z.string().regex(/^[1-9]\d{7,14}$/),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: z.string().regex(/^\d{1,12}$/),
  biz_opaque_callback_data: z.uuid().optional(),
});
const webhookSchema = z.object({ object: z.literal("whatsapp_business_account"), entry: z.array(z.object({
  id: z.string(), changes: z.array(z.object({ field: z.string(), value: z.object({
    messaging_product: z.literal("whatsapp"), metadata: z.object({ phone_number_id: z.string() }),
    statuses: z.array(z.unknown()).max(100).optional(),
  }) })).max(100),
})).max(100) });

export function crearWebhookWhatsapp(servicio: ReturnType<typeof crearServicioWhatsapp>) {
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", (req, res) => {
    const config = servicio.config;
    if (!config) { res.sendStatus(503); return; }
    const token = req.query["hub.verify_token"], challenge = req.query["hub.challenge"];
    if (req.query["hub.mode"] !== "subscribe" || typeof token !== "string" || token.length > 256 ||
      typeof challenge !== "string" || !/^[\w-]{1,256}$/.test(challenge) ||
      !timingSafeEqual(createHash("sha256").update(token).digest(), createHash("sha256").update(config.verificar).digest())) {
      res.sendStatus(403); return;
    }
    res.type("text/plain").send(challenge);
  });
  router.post("/", express.raw({ type: "application/json", limit: "256kb", inflate: false }), async (req, res) => {
    const config = servicio.config;
    if (!config) { res.sendStatus(503); return; }
    if (!Buffer.isBuffer(req.body) || !firmaWhatsappValida(req.body, req.get("X-Hub-Signature-256"), config.secreto)) {
      res.sendStatus(403); return;
    }
    try {
      const payload = webhookSchema.safeParse(JSON.parse(req.body.toString("utf8")));
      if (!payload.success) { res.sendStatus(400); return; }
      let cantidad = 0;
      for (const entry of payload.data.entry) {
        if (entry.id !== config.cuentaId) continue;
        for (const change of entry.changes) {
          if (change.field !== "messages" || change.value.metadata.phone_number_id !== config.numeroId) continue;
          for (const raw of change.value.statuses ?? []) {
            if (++cantidad > 100) { res.sendStatus(400); return; }
            const parsed = estadoSchema.safeParse(raw);
            if (!parsed.success) continue;
            const dato = parsed.data;
            const fecha = Number(dato.timestamp) * 1000;
            if (!Number.isSafeInteger(fecha) || fecha <= 0 || fecha > Date.now() + 600000) continue;
            const estados = { sent: "enviado", delivered: "entregado", read: "leido", failed: "error" } as const;
            const evento: EventoWhatsapp = { mensaje: dato.id, destinatario: `+${dato.recipient_id}`, estado: estados[dato.status],
              fecha: new Date(fecha).toISOString(), correlacion: dato.biz_opaque_callback_data };
            if (!await servicio.evento(evento)) { res.sendStatus(503); return; }
          }
        }
      }
      res.sendStatus(200);
    } catch (error) { res.sendStatus(error instanceof SyntaxError ? 400 : 503); }
  });
  router.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.sendStatus(400); });
  return router;
}
