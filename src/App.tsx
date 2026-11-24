import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import { useNavigate } from "react-router";
import { OrgProvider, useOrg } from "./lib/org";
import { Accounts } from "./pages/Accounts";
import { Automations } from "./pages/Automations";
import { CreateWorkspace } from "./pages/CreateWorkspace";
import { Errors } from "./pages/Errors";
import { Home } from "./pages/Home";
import { Inbox } from "./pages/Inbox";
import { Knowledge } from "./pages/Knowledge";
import { AcceptInvite, DeletionStatus, Privacy, Terms } from "./pages/Public";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";
import { Usage } from "./pages/Usage";

function NewWorkspace() {
  const { setOrgId } = useOrg();
  const nav = useNavigate();
  return <CreateWorkspace onDone={(id) => { setOrgId(id as never); nav("/"); }} />;
}

export function App() {
  return (
    <Routes>
      {/* Public pages (required by Meta app review) */}
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/deletion" element={<DeletionStatus />} />
      <Route
        path="*"
        element={
          <>
            <AuthLoading><div className="p-8 text-sm text-ink-soft">Cargando…</div></AuthLoading>
            <Unauthenticated><SignIn /></Unauthenticated>
            <Authenticated>
              <Routes>
                <Route path="/invite/:token" element={<AcceptInvite />} />
                <Route path="*" element={
              <OrgProvider empty={<CreateWorkspace />}>
                <Routes>
                  <Route element={<Shell />}>
                    <Route path="new" element={<NewWorkspace />} />
                    <Route index element={<Home />} />
                    <Route path="inbox" element={<Inbox />} />
                    <Route path="automations" element={<Automations />} />
                    <Route path="accounts" element={<Accounts />} />
                    <Route path="knowledge" element={<Knowledge />} />
                    <Route path="usage" element={<Usage />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="errors" element={<Errors />} />
                    <Route path="*" element={<Home />} />
                  </Route>
                </Routes>
              </OrgProvider>
                } />
              </Routes>
            </Authenticated>
          </>
        }
      />
    </Routes>
  );
}
