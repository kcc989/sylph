import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { env } from "cloudflare:workers"
import { getInstallationSetupStatus } from "@/server/installation-setup"

export const getInstallationSetup = createServerFn({ method: "GET" }).handler(
  () => getInstallationSetupStatus(getRequest(), env)
)
