import { z } from "zod";

export const correoValido = z.email().max(150).refine(valor => !/[\x00-\x1f\x7f-\x9f]/.test(valor));
export const correoSolicitud = z.string()
  .refine(valor => !/[\x00-\x1f\x7f-\x9f]/.test(valor))
  .transform(valor => valor.trim())
  .pipe(correoValido);
