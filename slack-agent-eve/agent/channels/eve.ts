import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

// HTTP channel auth: the eve dev TUI and `eve invoke` work locally, Vercel
// deployments authenticate via OIDC, and everything else gets a 401.
export default eveChannel({
  auth: [vercelOidc(), localDev(), placeholderAuth()],
});
