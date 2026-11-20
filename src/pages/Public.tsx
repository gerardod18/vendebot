import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useParams, useSearchParams } from "react-router";
import { api } from "../../convex/_generated/api";
import { Card, ErrorText, useRun } from "../components/ui";

const Page = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mx-auto max-w-2xl p-6"><Link to="/" className="text-sm underline">← vendebot</Link><h1 className="my-4 text-2xl font-semibold">{title}</h1><div className="space-y-3 text-sm leading-6 text-zinc-700">{children}</div></div>
);

/** DRAFT legal text: have it reviewed by a lawyer and fill the bracketed fields before going live. */
export function Privacy() {
  return (
    <Page title="Política de privacidad (borrador)">
      <p>Última actualización: [fecha]. Responsable: [razón social], [país], contacto: [email].</p>
      <p><b>Qué datos tratamos.</b> Para el cliente (el negocio): email y nombre de usuario. Para los clientes finales del negocio que escriben por Instagram: su identificador de Instagram, nombre de usuario, el contenido de sus mensajes y comentarios, y las etiquetas o datos que el negocio guarde sobre ellos.</p>
      <p><b>Para qué.</b> Responder mensajes y comentarios de forma automática o manual en nombre del negocio, mostrar la bandeja de entrada y medir el uso del servicio. No vendemos datos ni los usamos para publicidad.</p>
      <p><b>IA.</b> Cuando una automatización usa IA, el texto de la conversación y la información que el negocio cargó se envían al proveedor de modelos elegido (Anthropic u OpenRouter y el modelo que este enrute) solo para generar la respuesta.</p>
      <p><b>Conservación.</b> Los eventos crudos de Instagram se eliminan a los 30 días; las ejecuciones de automatizaciones a los 90 días. Los mensajes se conservan mientras exista el espacio de trabajo.</p>
      <p><b>Tus derechos.</b> Puedes pedir la eliminación de tus datos desde Instagram (Configuración → Apps y sitios web → vendebot → Eliminar) o escribiendo a [email]. Procesamos la solicitud automáticamente y recibes un código de confirmación.</p>
      <p><b>Seguridad.</b> Los tokens de acceso de Instagram se guardan cifrados. El acceso está aislado por espacio de trabajo.</p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Términos del servicio (borrador)">
      <p>Última actualización: [fecha]. Prestador: [razón social].</p>
      <p><b>Uso permitido.</b> Solo puedes automatizar cuentas de Instagram profesionales que administres y cumplir las políticas de Meta: no enviar mensajes no solicitados, respetar la ventana de 24 horas y ofrecer siempre una vía para hablar con una persona.</p>
      <p><b>Contenido de IA.</b> Las respuestas generadas por IA pueden contener errores. Eres responsable de la información que cargas y de revisar el comportamiento de tu asistente. Los precios y condiciones comerciales que el asistente comunique deben provenir de lo que cargaste.</p>
      <p><b>Planes y límites.</b> Cada plan incluye una cantidad mensual de respuestas de IA. Al agotarla, las automatizaciones usan su mensaje alternativo.</p>
      <p><b>Disponibilidad.</b> El servicio depende de Instagram/Meta y de proveedores de IA; no garantizamos disponibilidad continua. [Completar: precios, cancelación, ley aplicable.]</p>
    </Page>
  );
}

export function DeletionStatus() {
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";
  const r = useQuery(api.privacy.deletionStatus, { code });
  return (
    <Page title="Estado de eliminación de datos">
      {r === undefined ? <p>Cargando…</p> : r === null ? <p>No encontramos esa solicitud.</p>
        : <p>{r.status === "completed" ? `Tus datos fueron eliminados (${r.deletedContacts} contacto/s).` : "No teníamos datos asociados a tu cuenta."} Solicitud: {new Date(r.requestedAt).toLocaleString("es")}.</p>}
    </Page>
  );
}

export function AcceptInvite() {
  const { token = "" } = useParams();
  const accept = useMutation(api.orgs.acceptInvite);
  const { run, error } = useRun();
  const [done, setDone] = useState(false);
  useEffect(() => {
    void (async () => {
      const orgId = await run(() => accept({ token }));
      if (orgId) { try { localStorage.setItem("vendebot.orgId", orgId); } catch { /* ignore */ } setDone(true); window.location.assign("/"); }
    })();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="mx-auto mt-24 max-w-sm"><Card><p className="text-sm">{done ? "¡Listo!" : error ? "" : "Aceptando invitación…"}</p><ErrorText error={error} /></Card></div>;
}
