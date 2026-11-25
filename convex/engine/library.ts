/**
 * Ready-made sales flows, from a one-message reply to a multi-turn funnel. Pure data: each entry builds a graph
 * that passes `validateGraph`. Sample copy is for a fictional specialty-coffee shop ("Café Aurora"); owners edit it
 * in the flow editor. Design rules (from DM-funnel research): answer first, ask at most 2-3 questions, nudge once
 * inside the 24h window, keep a human exit, and send comment replies as ONE message (a private reply allows one).
 */
import { validateGraph, type Graph, type GraphNode } from "./graph";

export type LibraryLevel = "Básica" | "Intermedia" | "Avanzada" | "Experta";
export type LibraryTrigger = {
  type: "welcome" | "keyword" | "default" | "comment";
  keywords?: string[];
  match?: "contains" | "exact";
};
export type LibraryFlow = {
  id: string;
  title: string;
  level: LibraryLevel;
  /** What the person sees in the gallery. */
  summary: string;
  /** Short list of what happens, in order. */
  steps: string[];
  trigger: LibraryTrigger;
  channels: ("instagram" | "whatsapp")[];
  graph: Graph;
};

type Edge = [from: string, port: string, to: string];
const g = (startNodeId: string, nodes: GraphNode[], edges: Edge[]): Graph => ({
  startNodeId, nodes, edges: edges.map(([from, port, to]) => ({ from, port, to })),
});
const msg = (id: string, text: string): GraphNode => ({ id, type: "message", text });
const qr = (id: string, text: string, options: [title: string, payload: string][]): GraphNode => ({
  id, type: "quickReplies", text, options: options.map(([title, payload]) => ({ title, payload })),
});
const act = (id: string, actions: Extract<GraphNode, { type: "action" }>["actions"]): GraphNode => ({ id, type: "action", actions });
const ask = (id: string, timeoutMinutes: number, saveAs?: string): GraphNode => ({ id, type: "waitForReply", timeoutMinutes, ...(saveAs ? { saveAs } : {}) });
const human = (id: string, message?: string): GraphNode => ({ id, type: "handoff", ...(message ? { message } : {}) });

const PRICES =
  "Café en grano 250 g: $180\nCafé molido 250 g: $180\nSuscripción mensual (2 bolsas): $320\nEnvío gratis desde $400.";

export const LIBRARY: LibraryFlow[] = [
  {
    id: "precio-rapido",
    title: "Respuesta rápida de precios",
    level: "Básica",
    summary: "Cuando alguien pregunta por el precio, responde al instante y marca al cliente como interesado.",
    steps: ["Detecta «precio», «costo» o «cuánto cuesta»", "Etiqueta al cliente como «pidio_precio»", "Envía la lista de precios"],
    trigger: { type: "keyword", keywords: ["precio", "precios", "costo", "cuánto cuesta"], match: "contains" },
    channels: ["instagram", "whatsapp"],
    graph: g("tag", [
      act("tag", [{ kind: "addTag", tag: "pidio_precio" }]),
      msg("precios", `Hola {{first_name}}, estos son nuestros precios:\n${PRICES}\nSi quieres ordenar, escribe «pedido».`),
    ], [["tag", "next", "precios"]]),
  },
  {
    id: "bienvenida-menu",
    title: "Bienvenida con menú",
    level: "Intermedia",
    summary: "Saluda la primera vez que alguien escribe y le deja elegir: productos, horarios o una persona.",
    steps: ["Saluda con tres botones", "Responde productos u horarios y pregunta si necesita algo más", "Pasa a una persona si la pide"],
    trigger: { type: "welcome" },
    channels: ["instagram", "whatsapp"],
    graph: g("menu", [
      qr("menu", "Hola {{first_name}}, bienvenido a Café Aurora. ¿Qué te gustaría hacer?", [["Ver productos", "productos"], ["Horarios y envíos", "info"], ["Hablar con alguien", "persona"]]),
      msg("prod", `Esto es lo que tenemos:\n${PRICES}`),
      msg("info", "Atendemos de lunes a sábado de 9:00 a 18:00. Enviamos a todo el país en 2 a 4 días hábiles."),
      human("persona", "Te paso con un asesor, te responde en breve."),
      qr("mas", "¿Te ayudo con algo más?", [["Quiero pedir", "pedir"], ["No, gracias", "fin"]]),
      msg("pedir", "Perfecto. Escribe la palabra «pedido» y te tomo los datos."),
      msg("fin", "Gracias por escribirnos, aquí estaremos cuando nos necesites."),
    ], [
      ["menu", "productos", "prod"], ["menu", "info", "info"], ["menu", "persona", "persona"], ["menu", "next", "persona"],
      ["prod", "next", "mas"], ["info", "next", "mas"],
      ["mas", "pedir", "pedir"], ["mas", "fin", "fin"], ["mas", "next", "persona"],
    ]),
  },
  {
    id: "pedido-paso-a-paso",
    title: "Pedido paso a paso",
    level: "Avanzada",
    summary: "Conversación de varios turnos: pide nombre, producto y teléfono, guarda las respuestas y avisa al equipo.",
    steps: ["Detecta «pedido» o «comprar»", "Pregunta el nombre y espera la respuesta", "Ofrece tres productos con botones", "Pide el teléfono (si no responde, avisa igual al equipo)", "Etiqueta el lead y deja una nota con los datos"],
    trigger: { type: "keyword", keywords: ["pedido", "pedir", "comprar", "quiero comprar"], match: "contains" },
    channels: ["instagram", "whatsapp"],
    graph: g("intro", [
      msg("intro", "Con gusto. Te haré tres preguntas rápidas para preparar tu pedido."),
      msg("q_nombre", "¿Cómo te llamas?"),
      ask("r_nombre", 60, "nombre"),
      msg("retomar", "Cuando quieras retomar tu pedido, escribe «pedido»."),
      qr("q_prod", "Mucho gusto, {{nombre}}. ¿Qué producto buscas?", [["Grano entero", "grano"], ["Molido", "molido"], ["Suscripción", "suscripcion"]]),
      act("s_grano", [{ kind: "addTag", tag: "interes_grano" }, { kind: "setField", key: "interes", value: "café en grano" }]),
      act("s_molido", [{ kind: "addTag", tag: "interes_molido" }, { kind: "setField", key: "interes", value: "café molido" }]),
      act("s_susc", [{ kind: "addTag", tag: "interes_suscripcion" }, { kind: "setField", key: "interes", value: "suscripción mensual" }]),
      msg("q_tel", "Perfecto. ¿A qué número de teléfono te contactamos para coordinar la entrega?"),
      ask("r_tel", 120, "telefono"),
      act("sin_tel", [{ kind: "addTag", tag: "lead_sin_telefono" }, { kind: "note", text: "{{nombre}} quiso {{interes}} pero no dejó teléfono." }]),
      act("lead", [{ kind: "addTag", tag: "lead_calificado" }, { kind: "note", text: "Pedido: {{nombre}}, {{interes}}, teléfono {{telefono}}." }]),
      msg("ok", "Listo, {{nombre}}. Recibimos tu pedido de {{interes}}. Un asesor lo confirma contigo en breve."),
      human("fin"),
      // A free-text answer that matches none of the options is NOT a product choice: never record it as a fact.
      human("fuera_menu", "No encontré esa opción. Te paso con una persona del equipo para ayudarte con tu pedido."),
    ], [
      ["intro", "next", "q_nombre"], ["q_nombre", "next", "r_nombre"], ["r_nombre", "next", "q_prod"], ["r_nombre", "timeout", "retomar"],
      ["q_prod", "grano", "s_grano"], ["q_prod", "molido", "s_molido"], ["q_prod", "suscripcion", "s_susc"], ["q_prod", "next", "fuera_menu"],
      ["s_grano", "next", "q_tel"], ["s_molido", "next", "q_tel"], ["s_susc", "next", "q_tel"],
      ["q_tel", "next", "r_tel"], ["r_tel", "next", "lead"], ["r_tel", "timeout", "sin_tel"],
      ["sin_tel", "next", "fin"], ["lead", "next", "ok"], ["ok", "next", "fin"],
    ]),
  },
  {
    id: "asesor-ia-horario",
    title: "Asesor de IA con horario",
    level: "Avanzada",
    summary: "Respuesta por defecto: la IA atiende en horario de atención; fuera de horario, un aviso. Si se acaba la cuota, pasa a una persona.",
    steps: ["Revisa si está dentro del horario de atención", "La IA conversa usando la base de conocimiento", "Termina cuando el cliente quiere ordenar o pide una persona", "Fuera de horario deja un aviso y una nota para el equipo"],
    trigger: { type: "default" },
    channels: ["instagram", "whatsapp"],
    graph: g("hours", [
      { id: "hours", type: "filter", mode: "all", conditions: [{ kind: "businessHours" }] },
      {
        id: "ia", type: "aiAgent", useKnowledge: true, timeoutMinutes: 60,
        instructions: "Eres el asistente de Café Aurora, una tienda de café de especialidad. Responde breve y amable, en español, con lo que sabes del negocio. Usa solo los precios y datos de la base de conocimiento; si no lo sabes, dilo y ofrece pasar con una persona. No inventes promociones.",
        exitWhen: "el cliente quiere ordenar, pide hablar con una persona o ya no necesita nada más",
      },
      act("ia_tag", [{ kind: "addTag", tag: "ia_atendido" }]),
      msg("ia_fin", "Gracias por escribirnos. Un asesor dará seguimiento si hace falta."),
      msg("ia_tarde", "Sigo por aquí por si necesitas algo más."),
      msg("sin_cuota", "Un asesor te responderá en breve."),
      human("fin_cuota"),
      msg("fuera", "Ahora estamos fuera de horario (lunes a sábado, 9:00 a 18:00). Te respondemos mañana a primera hora."),
      act("fuera_nota", [{ kind: "addTag", tag: "fuera_de_horario" }, { kind: "note", text: "Escribió fuera de horario. Responder al abrir." }]),
    ], [
      ["hours", "yes", "ia"], ["hours", "no", "fuera"],
      ["ia", "exit", "ia_tag"], ["ia", "timeout", "ia_tarde"], ["ia", "quota", "sin_cuota"],
      ["ia_tag", "next", "ia_fin"], ["sin_cuota", "next", "fin_cuota"], ["fuera", "next", "fuera_nota"],
    ]),
  },
  {
    id: "comentario-a-venta",
    title: "Comentario a venta con seguimiento",
    level: "Experta",
    summary: "Convierte comentarios en ventas: mensaje privado con botones, oferta, reserva y un recordatorio si no responde.",
    steps: ["Detecta comentarios con «info» o «quiero»", "Un solo mensaje privado con tres opciones", "Muestra la oferta elegida y pregunta si la reserva", "Si dice «más tarde», espera 2 horas y envía un recordatorio", "Captura el contacto, etiqueta al lead y avisa al equipo"],
    trigger: { type: "comment", keywords: ["info", "quiero", "precio"], match: "contains" },
    channels: ["instagram"],
    graph: g("q0", [
      qr("q0", "Hola {{first_name}}, gracias por comentar. ¿Qué te interesa?", [["Café en grano", "grano"], ["Suscripción", "suscripcion"], ["Regalos", "regalos"]]),
      msg("o_grano", "Café en grano de origen único, tostado cada semana. 250 g por $180, envío gratis desde $400."),
      msg("o_susc", "Suscripción: 2 bolsas al mes por $320. Pausas o cancelas cuando quieras."),
      msg("o_reg", "Cajas de regalo desde $450, con tarjeta personalizada."),
      qr("cta", "¿Te lo reservo?", [["Sí, reservar", "si"], ["Más tarde", "luego"]]),
      msg("dato", "Genial. ¿Cuál es tu teléfono o correo para enviarte los detalles del pedido?"),
      ask("r_dato", 120, "contacto"),
      act("lead", [{ kind: "addTag", tag: "lead_caliente" }, { kind: "note", text: "Reserva desde comentario: {{contacto}}." }]),
      msg("ok", "Anotado. Un asesor te escribe hoy mismo para confirmar."),
      human("fin"),
      { id: "espera", type: "wait", minutes: 120 },
      qr("recordar", "Sigo aquí por si quieres tu pedido. ¿Lo reservamos ahora?", [["Sí, reservar", "si"], ["No, gracias", "no"]]),
      act("no_int", [{ kind: "addTag", tag: "no_interesado" }]),
      msg("no_msg", "Entendido. Cuando quieras, escríbenos por aquí."),
      human("persona", "Te paso con un asesor para ayudarte mejor."),
      msg("sin_dato", "No hay problema, un asesor te escribirá por aquí."),
    ], [
      ["q0", "grano", "o_grano"], ["q0", "suscripcion", "o_susc"], ["q0", "regalos", "o_reg"], ["q0", "next", "persona"],
      ["o_grano", "next", "cta"], ["o_susc", "next", "cta"], ["o_reg", "next", "cta"],
      ["cta", "si", "dato"], ["cta", "luego", "espera"], ["cta", "next", "persona"],
      ["espera", "next", "recordar"], ["recordar", "si", "dato"], ["recordar", "no", "no_int"], ["recordar", "next", "persona"],
      ["dato", "next", "r_dato"], ["r_dato", "next", "lead"], ["r_dato", "timeout", "sin_dato"],
      ["lead", "next", "ok"], ["ok", "next", "fin"], ["sin_dato", "next", "persona"], ["no_int", "next", "no_msg"],
    ]),
  },
];

export const libraryById = (id: string) => LIBRARY.find((f) => f.id === id);

/** Every library flow must be valid; used by tests and by the create mutation. */
export function checkLibrary(): string[] {
  const errors: string[] = [];
  for (const f of LIBRARY) {
    const r = validateGraph(f.graph);
    if (!r.ok) errors.push(`${f.id}: ${r.errors.join("; ")}`);
  }
  return errors;
}
