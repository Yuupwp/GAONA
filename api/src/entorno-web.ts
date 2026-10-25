export function entornoWeb(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([clave]) => !clave.startsWith("WHATSAPP_") || clave === "WHATSAPP_IDEMPOTENCY_KEY")),
    MAIL_ENABLED: "false",
    WHATSAPP_ENABLED: "false",
  };
}
