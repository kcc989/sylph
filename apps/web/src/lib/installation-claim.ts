import { InstallationClaimRejected } from "@workspace/domain"

type InstallationClaimAccount = {
  email: string
  emailVerified: boolean
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

export const assertInstallationClaimIdentity = (
  account: InstallationClaimAccount,
  confirmedEmail: string
) => {
  if (!account.emailVerified) {
    throw new InstallationClaimRejected({
      message: "Verify your email before claiming this Installation",
    })
  }
  if (normalizeEmail(confirmedEmail) !== normalizeEmail(account.email)) {
    throw new InstallationClaimRejected({
      message: "The confirmed email does not match your signed-in account",
    })
  }
}
