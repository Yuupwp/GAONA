BEGIN;
UPDATE gaona_mensajeria.correos c SET
  estado = CASE WHEN c.estado IN ('preparando','enviando') THEN 'no_confirmado' WHEN c.estado = 'pendiente' THEN 'no_disponible' ELSE c.estado END,
  destinatario = NULL, actualizado_en = now()
FROM gaona_mensajeria.registros_web r WHERE r.solicitud_id = c.solicitud_id AND r.retener_hasta <= now();
UPDATE gaona_mensajeria.documentos d SET estado = 'expirado', pdf = NULL, reserva = NULL, vence_reserva = NULL, actualizado_en = now()
WHERE d.retener_hasta <= now() OR EXISTS (SELECT 1 FROM gaona_mensajeria.registros_web r WHERE r.solicitud_id = d.solicitud_id AND r.retener_hasta <= now());
UPDATE gaona_mensajeria.registros_web SET comprobante = NULL, actualizado_en = now() WHERE retener_hasta <= now() AND comprobante IS NOT NULL;
COMMIT;
